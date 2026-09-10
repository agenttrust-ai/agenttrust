export type AgentHealthStatus = "unknown" | "healthy" | "degraded" | "down";

export type CheckOutcome = { success: boolean };

const DEGRADED_THRESHOLD = 2;
const DOWN_THRESHOLD = 4;
const RECOVERY_THRESHOLD = 2;

function countLeadingConsecutive(
  checksNewestFirst: CheckOutcome[],
  matches: (check: CheckOutcome) => boolean,
): number {
  let count = 0;
  for (const check of checksNewestFirst) {
    if (!matches(check)) break;
    count++;
  }
  return count;
}

/**
 * Status only flips after a *run* of consecutive results, never a single
 * sample — a lone dropped request shouldn't flap a status pill that other
 * systems may be reading. `checksNewestFirst` must be ordered most-recent
 * first (as `checked_at desc` naturally gives it).
 *
 *   4 consecutive failures  → down
 *   2 consecutive failures  → degraded
 *   2 consecutive successes → healthy (recovers from degraded/down)
 *   anything short of that  → hold at `currentStatus` (or take the single
 *                             latest result at face value if there's no
 *                             prior status yet, i.e. still "unknown")
 */
export function deriveAgentStatus(
  currentStatus: AgentHealthStatus,
  checksNewestFirst: CheckOutcome[],
): AgentHealthStatus {
  if (checksNewestFirst.length === 0) return "unknown";

  const consecutiveFailures = countLeadingConsecutive(
    checksNewestFirst,
    (c) => !c.success,
  );
  if (consecutiveFailures >= DOWN_THRESHOLD) return "down";

  const consecutiveSuccesses = countLeadingConsecutive(
    checksNewestFirst,
    (c) => c.success,
  );
  if (consecutiveSuccesses >= RECOVERY_THRESHOLD) return "healthy";

  if (consecutiveFailures >= DEGRADED_THRESHOLD) return "degraded";

  if (currentStatus !== "unknown") return currentStatus;
  return checksNewestFirst[0].success ? "healthy" : "degraded";
}
