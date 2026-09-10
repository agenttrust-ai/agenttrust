import "server-only";
import type { AppDatabase } from "@/lib/db/rls";
import {
  claimDueAgents,
  getRecentChecksForStatus,
  recordHealthCheck,
  setAgentStatus,
} from "@/lib/db/queries/health-checks";
import { computeAndStoreReliabilityScore } from "@/lib/db/queries/reliability";
import { checkAgentHealth } from "./health-check";
import { deriveAgentStatus } from "./status";

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
      const result = await checkAgentHealth(agent.endpointUrl);
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
