import "server-only";
import { and, asc, count, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { agents, healthChecks, reliabilityScores } from "@/lib/db/schema";
import {
  withAnonContext,
  withDbErrorNormalization,
  withUserContext,
  type AppDatabase,
} from "@/lib/db/rls";
import { AppError, ErrorCode } from "@/lib/errors";
import {
  FORMULA_VERSION,
  SCORE_WINDOW_DAYS,
  computeReliabilityScore,
  type ReliabilityScore,
} from "@/lib/reliability/scoring";
import {
  classifyReliabilityScore,
  scoreEvidenceWindowStart,
  type ReliabilityScoreStatus,
} from "@/lib/reliability/freshness";

/**
 * Every check (pull or push — both land in `health_checks`) between
 * `windowStart` and `windowEnd`, oldest constraint first so the caller
 * doesn't need to re-sort. Service context: called from the pull cron
 * batch and the push heartbeat handler, never on behalf of a signed-in
 * user or an anonymous visitor directly.
 */
async function getHealthChecksInWindow(
  db: AppDatabase,
  agentId: string,
  windowStart: Date,
  windowEnd: Date,
): Promise<{ checkedAt: Date; success: boolean; latencyMs: number | null }[]> {
  return withDbErrorNormalization(() =>
    db
      .select({
        checkedAt: healthChecks.checkedAt,
        success: healthChecks.success,
        latencyMs: healthChecks.latencyMs,
      })
      .from(healthChecks)
      .where(
        and(
          eq(healthChecks.agentId, agentId),
          gte(healthChecks.checkedAt, windowStart),
          lte(healthChecks.checkedAt, windowEnd),
        ),
      )
      .orderBy(asc(healthChecks.checkedAt)),
  );
}

/** Persists one score snapshot. Service context — see `getHealthChecksInWindow`. */
async function recordReliabilityScore(
  db: AppDatabase,
  agentId: string,
  result: ReliabilityScore,
  windowStart: Date,
  windowEnd: Date,
): Promise<void> {
  await withDbErrorNormalization(() =>
    db.insert(reliabilityScores).values({
      agentId,
      score: result.score.toFixed(2),
      uptimeSubscore: result.uptimeSubscore.toFixed(2),
      latencySubscore: result.latencySubscore.toFixed(2),
      consistencySubscore: result.consistencySubscore.toFixed(2),
      incidentSubscore: result.incidentSubscore.toFixed(2),
      formulaVersion: FORMULA_VERSION,
      windowStart,
      windowEnd,
    }),
  );
}

/**
 * Computes this agent's current score from its own trailing
 * `SCORE_WINDOW_DAYS`-day history and stores it as a new snapshot — the one
 * function both the pull cron batch and the push heartbeat handler call
 * after recording a check, so a score snapshot accumulates from real
 * activity on either monitoring mode, never from invented data. Returns
 * `null` (and stores nothing) when there isn't yet enough history to
 * justify a score — see `computeReliabilityScore`.
 */
export async function computeAndStoreReliabilityScore(
  db: AppDatabase,
  agentId: string,
  now: Date,
): Promise<ReliabilityScore | null> {
  const windowStart = new Date(now.getTime() - SCORE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const checks = await getHealthChecksInWindow(db, agentId, windowStart, now);
  const result = computeReliabilityScore(checks);
  if (!result) return null;

  await recordReliabilityScore(db, agentId, result, windowStart, now);
  return result;
}

export type ReliabilityScoreRow = typeof reliabilityScores.$inferSelect;

export type DisplayReliabilityScore = {
  score: number;
  uptimeSubscore: number;
  latencySubscore: number;
  consistencySubscore: number;
  incidentSubscore: number;
  computedAt: Date;
  windowStart: Date;
  windowEnd: Date;
};

function toDisplayScore(row: ReliabilityScoreRow): DisplayReliabilityScore {
  return {
    score: Number(row.score),
    uptimeSubscore: Number(row.uptimeSubscore),
    latencySubscore: Number(row.latencySubscore),
    consistencySubscore: Number(row.consistencySubscore),
    incidentSubscore: Number(row.incidentSubscore),
    computedAt: row.computedAt,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
  };
}

/** The owner's dashboard/agent-detail view of the latest snapshot — `null` means no score has been computed yet (insufficient history so far). */
export async function getLatestReliabilityScoreForOwnedAgent(
  db: AppDatabase,
  ownerId: string,
  agentId: string,
): Promise<DisplayReliabilityScore | null> {
  return withUserContext(db, ownerId, async (tx) => {
    const owned = await tx
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.ownerId, ownerId)))
      .limit(1);
    if (owned.length === 0) {
      throw new AppError(ErrorCode.NOT_FOUND, "Agent not found.");
    }

    const [row] = await tx
      .select()
      .from(reliabilityScores)
      .where(eq(reliabilityScores.agentId, agentId))
      .orderBy(desc(reliabilityScores.computedAt))
      .limit(1);
    return row ? toDisplayScore(row) : null;
  });
}

export type LatestScoreByAgent = Map<string, DisplayReliabilityScore>;

/**
 * The agents-list page's batched equivalent of
 * `getLatestReliabilityScoreForOwnedAgent` — one query for every agent
 * being listed instead of one per row, same `DISTINCT ON` shape as
 * `getLatestChecksForAgents`. Ownership is implicit: `agentIds` should
 * already be the caller's own agents, and this still runs inside
 * `withUserContext` so RLS backs that up.
 */
export async function getLatestReliabilityScoresForAgents(
  db: AppDatabase,
  ownerId: string,
  agentIds: string[],
): Promise<LatestScoreByAgent> {
  if (agentIds.length === 0) return new Map();

  return withUserContext(db, ownerId, async (tx) => {
    const rows = await tx
      .selectDistinctOn([reliabilityScores.agentId])
      .from(reliabilityScores)
      .where(inArray(reliabilityScores.agentId, agentIds))
      .orderBy(reliabilityScores.agentId, desc(reliabilityScores.computedAt));

    return new Map(rows.map((row) => [row.agentId, toDisplayScore(row)]));
  });
}

/**
 * The public profile page's / Public API's equivalent — no signed-in
 * owner, so it runs as Supabase's anonymous role, same shape as
 * `getLatestCheckPublic`. Only ever called with an agent id that
 * `getPublicAgentBySlug` already confirmed is public+active; RLS's
 * "visible if agent visible" policy backs that up independently.
 */
export async function getLatestReliabilityScorePublic(
  db: AppDatabase,
  agentId: string,
): Promise<DisplayReliabilityScore | null> {
  return withAnonContext(db, async (tx) => {
    const [row] = await tx
      .select()
      .from(reliabilityScores)
      .where(eq(reliabilityScores.agentId, agentId))
      .orderBy(desc(reliabilityScores.computedAt))
      .limit(1);
    return row ? toDisplayScore(row) : null;
  });
}

/**
 * Health checks per agent in the trailing scoring window ending at `now` —
 * the evidence count `classifyReliabilityScore` needs. Same bounds as
 * `computeAndStoreReliabilityScore` (both ends inclusive). Runs inside
 * whatever RLS context the caller's `tx` already carries.
 */
async function countRecentChecks(
  tx: AppDatabase,
  agentIds: string[],
  now: Date,
): Promise<Map<string, number>> {
  if (agentIds.length === 0) return new Map();
  const rows = await tx
    .select({ agentId: healthChecks.agentId, n: count() })
    .from(healthChecks)
    .where(
      and(
        inArray(healthChecks.agentId, agentIds),
        gte(healthChecks.checkedAt, scoreEvidenceWindowStart(now)),
        lte(healthChecks.checkedAt, now),
      ),
    )
    .groupBy(healthChecks.agentId);
  return new Map(rows.map((row) => [row.agentId, Number(row.n)]));
}

/** An agent's latest stored score together with whether it's still current. */
export type ReliabilityScoreState = {
  score: DisplayReliabilityScore | null;
  status: ReliabilityScoreStatus;
};

/**
 * The public equivalent of `getLatestReliabilityScorePublic`, plus
 * freshness — same anonymous role, same "only for an already-confirmed
 * public+active agent" contract. The historical score is returned as-is
 * even when stale; `status` is what says whether it's current evidence.
 */
export async function getReliabilityScoreStatePublic(
  db: AppDatabase,
  agentId: string,
  now: Date = new Date(),
): Promise<ReliabilityScoreState> {
  const [score, counts] = await Promise.all([
    getLatestReliabilityScorePublic(db, agentId),
    withAnonContext(db, (tx) => countRecentChecks(tx, [agentId], now)),
  ]);
  return {
    score,
    status: classifyReliabilityScore({
      latestScore: score,
      recentCheckCount: counts.get(agentId) ?? 0,
      now,
    }),
  };
}

/**
 * Owner-side freshness for already-fetched latest scores (from
 * `getLatestReliabilityScoresForAgents` or
 * `getLatestReliabilityScoreForOwnedAgent`) — one grouped count for every
 * agent, run as the owner so RLS scopes it to their own agents' checks.
 */
export async function getReliabilityScoreStatusesForOwnedAgents(
  db: AppDatabase,
  ownerId: string,
  latestScores: Map<string, DisplayReliabilityScore | null>,
  now: Date = new Date(),
): Promise<Map<string, ReliabilityScoreStatus>> {
  const agentIds = [...latestScores.keys()];
  const counts = await withUserContext(db, ownerId, (tx) =>
    countRecentChecks(tx, agentIds, now),
  );
  return new Map(
    agentIds.map((id) => [
      id,
      classifyReliabilityScore({
        latestScore: latestScores.get(id) ?? null,
        recentCheckCount: counts.get(id) ?? 0,
        now,
      }),
    ]),
  );
}
