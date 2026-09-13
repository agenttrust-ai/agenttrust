import "server-only";
import type { AppDatabase } from "@/lib/db/rls";
import {
  claimDueAgents,
  getRecentChecksForStatus,
  recordHealthCheck,
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

export type BatchSummary = {
  claimed: number;
  succeeded: number;
  failed: number;
  statusChanges: number;
};

/**
 * One cron invocation's worth of work: claim due agents, check each one,
 * record the result, re-derive status. Each agent is wrapped in its own
 * `Promise.allSettled` slot — one endpoint hanging, erroring, or timing out
 * must never take the rest of the batch down with it.
 */
export async function runHealthCheckBatch(
  db: AppDatabase,
  batchSize: number,
): Promise<BatchSummary> {
  const claimed = await claimDueAgents(db, batchSize);

  const results = await Promise.allSettled(
    claimed.map(async (agent) => {
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
    }),
  );

  let succeeded = 0;
  let failed = 0;
  let statusChanges = 0;

  for (const settled of results) {
    if (settled.status === "fulfilled") {
      if (settled.value.success) succeeded++;
      else failed++;
      if (settled.value.statusChanged) statusChanges++;
    } else {
      failed++;
      console.error(
        "Health check batch item failed unexpectedly:",
        settled.reason,
      );
    }
  }

  return { claimed: claimed.length, succeeded, failed, statusChanges };
}
