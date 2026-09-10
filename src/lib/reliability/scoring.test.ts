import { describe, expect, it } from "vitest";
import {
  BAD_LATENCY_MS,
  GOOD_LATENCY_MS,
  MIN_SAMPLES_FOR_SCORE,
  type ScoredCheck,
  computeReliabilityScore,
} from "./scoring";

const baseTime = new Date("2026-01-01T00:00:00.000Z");

function checksAt(
  count: number,
  build: (i: number) => Partial<ScoredCheck>,
): ScoredCheck[] {
  return Array.from({ length: count }, (_, i) => ({
    checkedAt: new Date(baseTime.getTime() + i * 60_000),
    success: true,
    latencyMs: 100,
    ...build(i),
  }));
}

describe("computeReliabilityScore — insufficient data", () => {
  it("returns null below the minimum sample threshold", () => {
    const checks = checksAt(MIN_SAMPLES_FOR_SCORE - 1, () => ({}));
    expect(computeReliabilityScore(checks)).toBeNull();
  });

  it("returns null for zero history", () => {
    expect(computeReliabilityScore([])).toBeNull();
  });

  it("returns a real score once the minimum sample threshold is met", () => {
    const checks = checksAt(MIN_SAMPLES_FOR_SCORE, () => ({}));
    expect(computeReliabilityScore(checks)).not.toBeNull();
  });
});

describe("computeReliabilityScore — healthy history", () => {
  it("scores a long run of fast successes very highly", () => {
    const checks = checksAt(50, () => ({ success: true, latencyMs: 80 }));
    const result = computeReliabilityScore(checks)!;
    expect(result.uptimeSubscore).toBe(100);
    expect(result.latencySubscore).toBe(100);
    expect(result.consistencySubscore).toBe(100);
    expect(result.incidentSubscore).toBe(100);
    expect(result.score).toBe(100);
    expect(result.sampleSize).toBe(50);
  });
});

describe("computeReliabilityScore — degraded history", () => {
  it("scores noticeably lower for a history with a real (but short) outage", () => {
    const healthy = computeReliabilityScore(
      checksAt(50, () => ({ success: true, latencyMs: 80 })),
    )!;
    // A single 3-check outage in the middle of an otherwise-healthy 50-check window.
    const degraded = computeReliabilityScore(
      checksAt(50, (i) => ({
        success: !(i >= 24 && i <= 26),
        latencyMs: 80,
      })),
    )!;

    expect(degraded.score).toBeLessThan(healthy.score);
    expect(degraded.uptimeSubscore).toBeCloseTo(94, 0); // 47/50
    expect(degraded.incidentSubscore).toBeLessThan(100);
  });
});

describe("computeReliabilityScore — down history", () => {
  it("scores very low for an agent that is down for the entire window", () => {
    const checks = checksAt(50, () => ({ success: false, latencyMs: null }));
    const result = computeReliabilityScore(checks)!;

    expect(result.uptimeSubscore).toBe(0);
    expect(result.incidentSubscore).toBe(0); // the single failure run spans the whole window
    expect(result.score).toBeLessThan(20);
  });

  it("never scores a total outage anywhere near a passing grade, regardless of neutral latency/consistency", () => {
    // All-failure, so latency has no successful samples (neutral 100) and
    // consistency has zero flips (100) — the score must still be low
    // because nothing should be able to offset a fully unavailable agent.
    const checks = checksAt(30, () => ({ success: false, latencyMs: null }));
    const result = computeReliabilityScore(checks)!;
    expect(result.latencySubscore).toBe(100);
    expect(result.consistencySubscore).toBe(100);
    expect(result.score).toBeLessThan(30);
  });

  it("orders healthy > degraded > down deterministically", () => {
    const healthy = computeReliabilityScore(
      checksAt(50, () => ({ success: true, latencyMs: 80 })),
    )!;
    const degraded = computeReliabilityScore(
      checksAt(50, (i) => ({ success: i % 4 !== 0, latencyMs: 80 })),
    )!;
    const down = computeReliabilityScore(
      checksAt(50, () => ({ success: false, latencyMs: null })),
    )!;

    expect(healthy.score).toBeGreaterThan(degraded.score);
    expect(degraded.score).toBeGreaterThan(down.score);
  });
});

describe("computeReliabilityScore — latency subscore", () => {
  it("scores 100 at or below the good-latency threshold", () => {
    const checks = checksAt(10, () => ({ success: true, latencyMs: GOOD_LATENCY_MS }));
    expect(computeReliabilityScore(checks)!.latencySubscore).toBe(100);
  });

  it("scores 0 at or above the bad-latency threshold", () => {
    const checks = checksAt(10, () => ({ success: true, latencyMs: BAD_LATENCY_MS }));
    expect(computeReliabilityScore(checks)!.latencySubscore).toBe(0);
  });

  it("interpolates linearly between the two thresholds", () => {
    const midpoint = (GOOD_LATENCY_MS + BAD_LATENCY_MS) / 2;
    const checks = checksAt(10, () => ({ success: true, latencyMs: midpoint }));
    expect(computeReliabilityScore(checks)!.latencySubscore).toBeCloseTo(50, 0);
  });

  it("is neutral (100), not penalized, when no check ever measured a latency (pure push history)", () => {
    const checks = checksAt(10, () => ({ success: true, latencyMs: null }));
    expect(computeReliabilityScore(checks)!.latencySubscore).toBe(100);
  });
});

describe("computeReliabilityScore — consistency subscore", () => {
  it("is 100 for a run with zero transitions between consecutive checks", () => {
    const checks = checksAt(20, () => ({ success: true }));
    expect(computeReliabilityScore(checks)!.consistencySubscore).toBe(100);
  });

  it("drops as the result flips more often between consecutive checks", () => {
    const flapping = checksAt(20, (i) => ({ success: i % 2 === 0 }));
    const result = computeReliabilityScore(flapping)!;
    // Every consecutive pair flips — the worst possible case.
    expect(result.consistencySubscore).toBe(0);
  });
});

describe("computeReliabilityScore — push and pull agree on the same math", () => {
  it("scores identically for a pull-shaped history (real latencies) and a push-shaped one (null latencies), given the same success pattern", () => {
    const pullShaped = checksAt(20, () => ({ success: true, latencyMs: 90 }));
    const pushShaped = checksAt(20, () => ({ success: true, latencyMs: null }));

    const pullResult = computeReliabilityScore(pullShaped)!;
    const pushResult = computeReliabilityScore(pushShaped)!;

    // Both are "perfectly healthy" shapes — the only distinguishing
    // subscore is latency (which is neutral either way here), so uptime,
    // consistency, incident, and the final score all match.
    expect(pushResult.uptimeSubscore).toBe(pullResult.uptimeSubscore);
    expect(pushResult.consistencySubscore).toBe(pullResult.consistencySubscore);
    expect(pushResult.incidentSubscore).toBe(pullResult.incidentSubscore);
    expect(pushResult.score).toBe(pullResult.score);
  });
});

describe("computeReliabilityScore — determinism and input order", () => {
  it("is unaffected by the order checks are passed in", () => {
    const inOrder = checksAt(20, (i) => ({ success: i % 5 !== 0, latencyMs: 200 + i }));
    const shuffled = [...inOrder].reverse();

    expect(computeReliabilityScore(shuffled)).toEqual(computeReliabilityScore(inOrder));
  });

  it("produces the exact same result for the exact same input every time", () => {
    const checks = checksAt(30, (i) => ({ success: i % 3 !== 0, latencyMs: 250 }));
    const first = computeReliabilityScore(checks);
    const second = computeReliabilityScore(checks);
    expect(first).toEqual(second);
  });

  it("every subscore and the overall score stay within [0, 100]", () => {
    const checks = checksAt(40, (i) => ({
      success: i % 3 !== 0,
      latencyMs: i % 2 === 0 ? 50 : 20000,
    }));
    const result = computeReliabilityScore(checks)!;
    for (const value of [
      result.score,
      result.uptimeSubscore,
      result.latencySubscore,
      result.consistencySubscore,
      result.incidentSubscore,
    ]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });
});
