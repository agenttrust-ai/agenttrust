import "server-only";
import { and, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { agents, healthChecks } from "@/lib/db/schema";
import {
  withAnonContext,
  withDbErrorNormalization,
  withUserContext,
  type AppDatabase,
} from "@/lib/db/rls";
import { AppError, ErrorCode } from "@/lib/errors";
import type { CheckStatus } from "@/lib/monitoring/safe-fetch";
import type { AgentHealthStatus } from "@/lib/monitoring/status";

/**
 * Looser than `FetchOutcome`: a pull probe always measures a latency, but a
 * push heartbeat has none to report, so `latencyMs` is nullable here even
 * though it isn't on `FetchOutcome` — the column itself has always allowed
 * null. Every `FetchOutcome` still satisfies this shape as-is.
 */
type HealthCheckRecordInput = {
  status: CheckStatus;
  success: boolean;
  httpStatus: number | null;
  latencyMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export type ClaimedAgent = {
  id: string;
  endpointUrl: string;
  checkIntervalSeconds: number;
  currentStatus: AgentHealthStatus;
};

/**
 * Claims a batch of due agents for the calling cron invocation.
 *
 * The whole idempotency guarantee lives in this one short transaction:
 * `FOR UPDATE SKIP LOCKED` means a second, overlapping cron invocation can
 * never select a row this one is still holding — it just skips it and
 * claims nothing for that agent. Pushing `next_check_at` forward
 * immediately, before any network I/O, means that even a *non-overlapping*
 * duplicate invocation (the first one finished, a retry or a second
 * trigger fires moments later) finds nothing due, because the row is no
 * longer due until the next interval. No lock is held across the actual
 * HTTP request — that happens after this function returns.
 *
 * Runs directly against `db` (no `withUserContext`) — a trusted,
 * no-end-user server context, the same service-role pattern the
 * architecture reserves for cron jobs.
 */
export async function claimDueAgents(
  db: AppDatabase,
  limit: number,
): Promise<ClaimedAgent[]> {
  return withDbErrorNormalization(() =>
    db.transaction(async (tx) => {
      const due = await tx
        .select({
          id: agents.id,
          endpointUrl: agents.endpointUrl,
          checkIntervalSeconds: agents.checkIntervalSeconds,
          currentStatus: agents.currentStatus,
        })
        .from(agents)
        .where(
          and(
            eq(agents.lifecycleStatus, "active"),
            // Push-mode agents report in on their own — an outbound probe
            // would be redundant at best and, if their real endpoint isn't
            // even reachable by design (e.g. behind a firewall, polling out
            // instead of accepting inbound calls), actively wrong.
            eq(agents.monitoringMode, "pull"),
            or(isNull(agents.nextCheckAt), lte(agents.nextCheckAt, sql`now()`)),
          ),
        )
        .orderBy(sql`${agents.nextCheckAt} nulls first`)
        .limit(limit)
        .for("update", { of: agents, skipLocked: true });

      if (due.length === 0) return [];

      await tx
        .update(agents)
        .set({
          nextCheckAt: sql`now() + (${agents.checkIntervalSeconds} || ' seconds')::interval`,
        })
        .where(
          inArray(
            agents.id,
            due.map((a) => a.id),
          ),
        );

      return due;
    }),
  );
}

/**
 * Persists one check result — `method` distinguishes an outbound pull
 * probe from a push heartbeat, both landing in the same table so history
 * views and "last checked" summaries work identically for either.
 * Service context — see `claimDueAgents`.
 *
 * `checkedAt` defaults to the column's own `now()` when omitted, but a
 * caller that already captured its own authoritative `Date` earlier in the
 * same request (the push heartbeat handler does, for `lastHeartbeatAt`)
 * should pass it through explicitly — reusing the database's own clock
 * instead would record a timestamp *after* that already-committed `Date`,
 * which is exactly late enough to fall outside a reliability-score window
 * whose end was computed from the earlier value.
 */
export async function recordHealthCheck(
  db: AppDatabase,
  agentId: string,
  result: HealthCheckRecordInput,
  method: "pull" | "push" = "pull",
  checkedAt?: Date,
): Promise<void> {
  await withDbErrorNormalization(() =>
    db.insert(healthChecks).values({
      agentId,
      method,
      status: result.status,
      success: result.success,
      latencyMs: result.latencyMs,
      statusCode: result.httpStatus,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      ...(checkedAt ? { checkedAt } : {}),
    }),
  );
}

/** Updates the cached status column. Service context — see `claimDueAgents`. */
export async function setAgentStatus(
  db: AppDatabase,
  agentId: string,
  status: AgentHealthStatus,
): Promise<void> {
  await withDbErrorNormalization(() =>
    db
      .update(agents)
      .set({ currentStatus: status })
      .where(eq(agents.id, agentId)),
  );
}

/**
 * The last N results for one agent, newest first — exactly the shape
 * `deriveAgentStatus` (src/lib/monitoring/status.ts) expects. Service
 * context: called right after `recordHealthCheck`, before the next agent
 * in the batch, not on behalf of any particular signed-in user.
 */
export async function getRecentChecksForStatus(
  db: AppDatabase,
  agentId: string,
  limit = 10,
): Promise<{ success: boolean }[]> {
  return withDbErrorNormalization(() =>
    db
      .select({ success: healthChecks.success })
      .from(healthChecks)
      .where(eq(healthChecks.agentId, agentId))
      .orderBy(desc(healthChecks.checkedAt))
      .limit(limit),
  );
}

export type HealthCheckRow = typeof healthChecks.$inferSelect;

/** The owner's dashboard health-history view — ownership enforced in the query *and* by RLS. */
export async function listRecentChecksForOwnedAgent(
  db: AppDatabase,
  ownerId: string,
  agentId: string,
  limit = 25,
): Promise<HealthCheckRow[]> {
  return withUserContext(db, ownerId, async (tx) => {
    const owned = await tx
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.ownerId, ownerId)))
      .limit(1);
    if (owned.length === 0) {
      throw new AppError(ErrorCode.NOT_FOUND, "Agent not found.");
    }
    return tx
      .select()
      .from(healthChecks)
      .where(eq(healthChecks.agentId, agentId))
      .orderBy(desc(healthChecks.checkedAt))
      .limit(limit);
  });
}

export type LatestCheckByAgent = Map<string, HealthCheckRow>;

/**
 * The most recent check for each of the owner's agents, in one query
 * (`DISTINCT ON`) rather than one round trip per row — used by the agents
 * list page. Ownership is implicit: `agentIds` should already be the
 * caller's own agents (e.g. from `listAgentsForOwner`), and this still runs
 * inside `withUserContext` so RLS backs that up.
 */
export async function getLatestChecksForAgents(
  db: AppDatabase,
  ownerId: string,
  agentIds: string[],
): Promise<LatestCheckByAgent> {
  if (agentIds.length === 0) return new Map();

  return withUserContext(db, ownerId, async (tx) => {
    const rows = await tx
      .selectDistinctOn([healthChecks.agentId])
      .from(healthChecks)
      .where(inArray(healthChecks.agentId, agentIds))
      .orderBy(healthChecks.agentId, desc(healthChecks.checkedAt));

    return new Map(rows.map((row) => [row.agentId, row]));
  });
}

/**
 * The public profile page's equivalent of `getLatestChecksForAgents` — no
 * signed-in owner, so it runs as Supabase's anonymous role. Only ever
 * called with an agent id that `getPublicAgentBySlug` already confirmed is
 * public+active, and RLS's public-read policy backs that up independently.
 */
export async function getLatestCheckPublic(
  db: AppDatabase,
  agentId: string,
): Promise<HealthCheckRow | null> {
  return withAnonContext(db, async (tx) => {
    const [row] = await tx
      .select()
      .from(healthChecks)
      .where(eq(healthChecks.agentId, agentId))
      .orderBy(desc(healthChecks.checkedAt))
      .limit(1);
    return row ?? null;
  });
}
