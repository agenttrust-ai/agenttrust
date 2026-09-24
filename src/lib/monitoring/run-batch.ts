import "server-only";
import type { AppDatabase } from "@/lib/db/rls";
import {
  claimDueAgents,
  getRecentChecksForStatus,
  recordHealthCheck,
  releaseAgentClaims,
  setAgentStatus,
  type ClaimedAgent,
} from "@/lib/db/queries/health-checks";
import { computeAndStoreReliabilityScore } from "@/lib/db/queries/reliability";
import { env } from "@/lib/config.server";
import { decryptAgentCredential } from "@/lib/security/agent-credentials";
import { DEFAULT_AUTH_HEADER_NAME } from "@/lib/validation/agent-constants";
import { checkAgentHealth } from "./health-check";
import type { FetchAuthHeader, CheckStatus } from "./safe-fetch";
import { deriveAgentStatus } from "./status";

/**
 * Resolves the outbound auth header for one claimed agent, decrypting its
 * stored credential (if any) right here — immediately before the caller
 * passes it to `checkAgentHealth`, never earlier, never cached. `ok: false`
 * means decryption itself failed (wrong/rotated key, corrupted ciphertext);
 * the caller records that as a failed check rather than falling back to an
 * unauthenticated request, and this function never returns or logs the raw
 * error — only a fixed, credential-free failure signal.
 */
function resolveAuthHeader(
  agent: ClaimedAgent,
): { ok: true; authHeader?: FetchAuthHeader } | { ok: false } {
  if (!agent.authCredentialCiphertext) return { ok: true, authHeader: undefined };
  // "none" (no ciphertext, handled above) and any legacy/unsupported
  // authType (oauth2, custom) never get an auth header attached — this MVP
  // only ever sends one for bearer/api_key.
  if (agent.authType !== "bearer" && agent.authType !== "api_key") {
    return { ok: true, authHeader: undefined };
  }

  try {
    const plaintext = decryptAgentCredential(
      agent.authCredentialCiphertext,
      env.AGENT_CREDENTIAL_ENCRYPTION_KEY,
    );
    if (agent.authType === "bearer") {
      return { ok: true, authHeader: { name: "Authorization", value: `Bearer ${plaintext}` } };
    }
    return {
      ok: true,
      authHeader: {
        name: agent.authHeaderName ?? DEFAULT_AUTH_HEADER_NAME,
        value: plaintext,
      },
    };
  } catch {
    return { ok: false };
  }
}

/**
 * Most agents one cron run will check. Sized for the ~500-agents/day
 * target; bounds outbound request volume and check-row growth per run.
 */
export const HEALTH_CHECK_MAX_AGENTS_PER_RUN = 500;

/**
 * Checks in flight at once — the same peak parallelism the original
 * single batch of 20 already ran in production, so outbound connections
 * and database pressure never exceed what's already proven.
 */
export const HEALTH_CHECK_CONCURRENCY = 20;

/**
 * Agents claimed per claim transaction. Equal to the concurrency, so when
 * the time budget stops a run at most this many are claimed-but-unstarted
 * (and those are released again — see `releaseAgentClaims`).
 */
export const HEALTH_CHECK_CLAIM_CHUNK_SIZE = 20;

/**
 * Stop *starting* new checks this long after the run begins. The route's
 * hard limit is 300s (`maxDuration`); one agent's worst case is ~31.2s (3
 * attempts x the 10s per-attempt abort timer in safe-fetch.ts, plus 0.3s +
 * 0.9s retry backoff) plus a few DB writes, so the last check started at
 * 240s ends by ~276s — leaving ~24s for cold start, the claim transaction,
 * releasing leftover claims, and the response.
 */
export const HEALTH_CHECK_TIME_BUDGET_MS = 240_000;

export type BatchStopReason = "drained" | "max_agents" | "time_budget";

export type BatchSummary = {
  claimed: number;
  succeeded: number;
  failed: number;
  statusChanges: number;
  /** Claimed but not checked before the time budget ran out — released back to the queue. */
  deferred: number;
  stoppedReason: BatchStopReason;
  elapsedMs: number;
};

export type RunHealthCheckOptions = {
  concurrency?: number;
  chunkSize?: number;
  timeBudgetMs?: number;
  /** Injectable clock (ms since epoch) — tests only. */
  now?: () => number;
};

/**
 * One claimed agent's check, unchanged from the original single-batch
 * runner: probe, record the result, re-derive status, then a best-effort
 * reliability score. Throws only on an unexpected failure, which the
 * caller counts as `failed` without stopping the run.
 */
async function checkClaimedAgent(
  db: AppDatabase,
  agent: ClaimedAgent,
): Promise<{ success: boolean; statusChanged: boolean }> {
  // Captured once and reused for both the check row and the score
  // window's end — letting each instead use its own "now" (the DB's
  // `now()` for the row, a fresh `new Date()` for the window) would tie
  // correctness to the app server's clock never running even slightly
  // behind the database's, which isn't guaranteed once they're on
  // different hosts.
  const now = new Date();
  const resolution = resolveAuthHeader(agent);
  const result = resolution.ok
    ? await checkAgentHealth(agent.endpointUrl, resolution.authHeader)
    : {
        status: "unknown_error" as CheckStatus,
        success: false,
        httpStatus: null,
        latencyMs: 0,
        errorCode: "CREDENTIAL_DECRYPT_FAILED",
        errorMessage: "Couldn't decrypt the stored credential for this agent.",
        attempts: 0,
      };
  await recordHealthCheck(db, agent.id, result, "pull", now);

  const recentChecks = await getRecentChecksForStatus(db, agent.id);
  const nextStatus = deriveAgentStatus(agent.currentStatus, recentChecks);
  const statusChanged = nextStatus !== agent.currentStatus;
  if (statusChanged) {
    await setAgentStatus(db, agent.id, nextStatus);
  }

  // Best-effort: a scoring failure must never fail the health check
  // itself, which is the part callers actually depend on.
  try {
    await computeAndStoreReliabilityScore(db, agent.id, now);
  } catch (error) {
    console.error("Reliability score computation failed:", error);
  }

  return { success: result.success, statusChanged };
}

/**
 * One cron invocation's worth of work, processed as a bounded worker pool
 * instead of one all-at-once batch:
 *
 *   - Claims due agents in small chunks, only as workers need more, using
 *     the same `claimDueAgents` (FOR UPDATE SKIP LOCKED) as before.
 *   - Never more than `concurrency` checks in flight; a slow or dead
 *     endpoint only ties up one slot, not the whole run.
 *   - Stops starting new checks once `timeBudgetMs` has elapsed; checks
 *     already in flight finish normally. Anything claimed but not started
 *     is released so the next run picks it up first.
 *   - At most `maxAgents` per run, and never the same agent twice in one
 *     run (claims use the run's start time as the "due" cutoff).
 *
 * One agent's unexpected failure never stops the others. A failure to
 * claim still fails the run, as before — but only after in-flight checks
 * have finished and been recorded.
 */
export async function runHealthCheckBatch(
  db: AppDatabase,
  maxAgents: number,
  options: RunHealthCheckOptions = {},
): Promise<BatchSummary> {
  const concurrency = options.concurrency ?? HEALTH_CHECK_CONCURRENCY;
  const chunkSize = options.chunkSize ?? HEALTH_CHECK_CLAIM_CHUNK_SIZE;
  const timeBudgetMs = options.timeBudgetMs ?? HEALTH_CHECK_TIME_BUDGET_MS;
  const clock = options.now ?? Date.now;

  const startedAt = clock();
  const dueAsOf = new Date(startedAt);
  const budgetExhausted = () => clock() - startedAt >= timeBudgetMs;

  const queue: ClaimedAgent[] = [];
  let claimed = 0;
  let nothingLeftToClaim = false;
  let claimError: unknown = null;
  let claimInFlight: Promise<void> | null = null;
  let stoppedByBudget = false;

  let succeeded = 0;
  let failed = 0;
  let statusChanges = 0;

  async function claimChunk(): Promise<void> {
    const remaining = maxAgents - claimed;
    if (remaining <= 0) {
      nothingLeftToClaim = true;
      return;
    }
    const requested = Math.min(chunkSize, remaining);
    try {
      const chunk = await claimDueAgents(db, requested, { dueAsOf });
      claimed += chunk.length;
      queue.push(...chunk);
      if (chunk.length < requested) nothingLeftToClaim = true;
    } catch (error) {
      claimError = error;
      nothingLeftToClaim = true;
    }
  }

  // Only one claim transaction at a time; workers that run dry while a
  // claim is already in progress just wait for it.
  function claimMore(): Promise<void> {
    if (!claimInFlight) {
      claimInFlight = claimChunk().finally(() => {
        claimInFlight = null;
      });
    }
    return claimInFlight;
  }

  async function worker(): Promise<void> {
    for (;;) {
      if (queue.length === 0 && nothingLeftToClaim) return;
      // Only reached with work still queued or claimable, so a stop here
      // really is the budget — never a run that had simply finished.
      if (budgetExhausted()) {
        stoppedByBudget = true;
        return;
      }
      const agent = queue.shift();
      if (!agent) {
        await claimMore();
        continue;
      }
      try {
        const outcome = await checkClaimedAgent(db, agent);
        if (outcome.success) succeeded++;
        else failed++;
        if (outcome.statusChanged) statusChanges++;
      } catch (error) {
        failed++;
        console.error("Health check batch item failed unexpectedly:", error);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const leftover = queue.splice(0);
  if (leftover.length > 0) {
    try {
      await releaseAgentClaims(
        db,
        leftover.map((agent) => agent.id),
      );
    } catch (error) {
      // Not fatal: claimed agents become due again once their interval
      // passes anyway — releasing only restores their queue position.
      console.error("Failed to release unstarted health-check claims:", error);
    }
  }

  if (claimError) throw claimError;

  const stoppedReason: BatchStopReason = stoppedByBudget
    ? "time_budget"
    : claimed >= maxAgents
      ? "max_agents"
      : "drained";

  return {
    claimed,
    succeeded,
    failed,
    statusChanges,
    deferred: leftover.length,
    stoppedReason,
    elapsedMs: clock() - startedAt,
  };
}
