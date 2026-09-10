import { describe, expect, it } from "vitest";
import {
  HEARTBEAT_DEGRADED_AFTER_MISSED_INTERVALS,
  HEARTBEAT_DOWN_AFTER_MISSED_INTERVALS,
  deriveHeartbeatStatus,
  getEffectiveAgentStatus,
} from "./heartbeat-status";

const now = new Date("2026-01-01T00:00:00.000Z");
const intervalSeconds = 60;

function secondsAgo(seconds: number): Date {
  return new Date(now.getTime() - seconds * 1000);
}

describe("deriveHeartbeatStatus", () => {
  it("is unknown when no heartbeat has ever arrived", () => {
    expect(deriveHeartbeatStatus(null, intervalSeconds, now)).toBe("unknown");
  });

  it("is healthy for a heartbeat well within the interval", () => {
    expect(deriveHeartbeatStatus(secondsAgo(5), intervalSeconds, now)).toBe("healthy");
  });

  it("is still healthy exactly at the degraded threshold boundary", () => {
    const boundary = intervalSeconds * HEARTBEAT_DEGRADED_AFTER_MISSED_INTERVALS;
    expect(deriveHeartbeatStatus(secondsAgo(boundary), intervalSeconds, now)).toBe("healthy");
  });

  it("is degraded just past the degraded threshold", () => {
    const boundary = intervalSeconds * HEARTBEAT_DEGRADED_AFTER_MISSED_INTERVALS;
    expect(deriveHeartbeatStatus(secondsAgo(boundary + 1), intervalSeconds, now)).toBe("degraded");
  });

  it("is still degraded exactly at the down threshold boundary", () => {
    const boundary = intervalSeconds * HEARTBEAT_DOWN_AFTER_MISSED_INTERVALS;
    expect(deriveHeartbeatStatus(secondsAgo(boundary), intervalSeconds, now)).toBe("degraded");
  });

  it("is down once well past the down threshold", () => {
    const boundary = intervalSeconds * HEARTBEAT_DOWN_AFTER_MISSED_INTERVALS;
    expect(deriveHeartbeatStatus(secondsAgo(boundary + 1), intervalSeconds, now)).toBe("down");
  });

  it("scales thresholds with a slower agent's own check interval", () => {
    const slowInterval = 600; // 10 minutes
    // 15 minutes stale would already be "down" at a 60s interval (4 missed
    // 60s intervals = 240s), but for an agent whose own cadence is 10
    // minutes, 15 minutes is only 1.5 missed intervals — still healthy.
    expect(deriveHeartbeatStatus(secondsAgo(900), slowInterval, now)).toBe("healthy");
    // 25 minutes stale is 2.5 missed 10-minute intervals — past the
    // degraded threshold (2x) but short of the down threshold (4x = 40 min).
    expect(deriveHeartbeatStatus(secondsAgo(1500), slowInterval, now)).toBe("degraded");
  });
});

describe("getEffectiveAgentStatus", () => {
  it("uses the cached currentStatus for a pull-mode agent, ignoring lastHeartbeatAt entirely", () => {
    const status = getEffectiveAgentStatus(
      {
        monitoringMode: "pull",
        currentStatus: "healthy",
        lastHeartbeatAt: null, // a pull agent never gets heartbeats
        checkIntervalSeconds: intervalSeconds,
      },
      now,
    );
    expect(status).toBe("healthy");
  });

  it("ignores a stale lastHeartbeatAt for a pull-mode agent", () => {
    const status = getEffectiveAgentStatus(
      {
        monitoringMode: "pull",
        currentStatus: "healthy",
        lastHeartbeatAt: secondsAgo(999999),
        checkIntervalSeconds: intervalSeconds,
      },
      now,
    );
    expect(status).toBe("healthy");
  });

  it("derives from heartbeat freshness for a push-mode agent, ignoring the cached currentStatus", () => {
    const status = getEffectiveAgentStatus(
      {
        monitoringMode: "push",
        currentStatus: "unknown",
        lastHeartbeatAt: secondsAgo(5),
        checkIntervalSeconds: intervalSeconds,
      },
      now,
    );
    expect(status).toBe("healthy");
  });

  it("reports a push-mode agent as down once its heartbeat has gone stale", () => {
    const status = getEffectiveAgentStatus(
      {
        monitoringMode: "push",
        currentStatus: "healthy", // stale cached value — must not be trusted
        lastHeartbeatAt: secondsAgo(intervalSeconds * HEARTBEAT_DOWN_AFTER_MISSED_INTERVALS + 1),
        checkIntervalSeconds: intervalSeconds,
      },
      now,
    );
    expect(status).toBe("down");
  });

  it("reports a push-mode agent with no heartbeat yet as unknown", () => {
    const status = getEffectiveAgentStatus(
      {
        monitoringMode: "push",
        currentStatus: "unknown",
        lastHeartbeatAt: null,
        checkIntervalSeconds: intervalSeconds,
      },
      now,
    );
    expect(status).toBe("unknown");
  });
});
