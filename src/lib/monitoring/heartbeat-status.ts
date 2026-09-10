import type { AgentHealthStatus } from "./status";

/**
 * A push-mode agent's status is derived purely from how long ago its last
 * heartbeat arrived — there's no outbound check to run. Thresholds are
 * expressed as a multiple of the agent's own `checkIntervalSeconds` (the
 * same column pull mode uses for its polling cadence, reused here as "how
 * often this agent is expected to check in"), mirroring pull mode's
 * "2 consecutive misses → degraded, 4 → down" shape without hardcoding an
 * absolute number of seconds that would be wrong for a fast- or
 * slow-heartbeating agent alike. Centralized here so both numbers are easy
 * to retune later without hunting through call sites.
 */
export const HEARTBEAT_DEGRADED_AFTER_MISSED_INTERVALS = 2;
export const HEARTBEAT_DOWN_AFTER_MISSED_INTERVALS = 4;

export function deriveHeartbeatStatus(
  lastHeartbeatAt: Date | null,
  checkIntervalSeconds: number,
  now: Date = new Date(),
): AgentHealthStatus {
  if (!lastHeartbeatAt) return "unknown";

  const ageSeconds = (now.getTime() - lastHeartbeatAt.getTime()) / 1000;
  if (ageSeconds <= checkIntervalSeconds * HEARTBEAT_DEGRADED_AFTER_MISSED_INTERVALS) {
    return "healthy";
  }
  if (ageSeconds <= checkIntervalSeconds * HEARTBEAT_DOWN_AFTER_MISSED_INTERVALS) {
    return "degraded";
  }
  return "down";
}

type StatusSourceAgent = {
  monitoringMode: string;
  currentStatus: AgentHealthStatus;
  lastHeartbeatAt: Date | null;
  checkIntervalSeconds: number;
};

/**
 * The one place every surface (dashboard, public profile, the Public API)
 * should go to answer "what's this agent's status right now" — pull-mode
 * agents keep using the cached `currentStatus` the monitoring cron
 * maintains, push-mode agents are derived fresh from heartbeat recency on
 * every read, since staleness is a function of the clock, not an event.
 */
export function getEffectiveAgentStatus(
  agent: StatusSourceAgent,
  now: Date = new Date(),
): AgentHealthStatus {
  if (agent.monitoringMode === "push") {
    return deriveHeartbeatStatus(agent.lastHeartbeatAt, agent.checkIntervalSeconds, now);
  }
  return agent.currentStatus;
}
