import { describe, expect, it } from "vitest";
import {
  classifyReliabilityScore,
  scoreEvidenceWindowStart,
} from "./freshness";
import { MIN_SAMPLES_FOR_SCORE, SCORE_WINDOW_DAYS } from "./scoring";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-09-26T12:00:00.000Z");
const at = (msAgo: number) => new Date(now.getTime() - msAgo);

describe("scoreEvidenceWindowStart", () => {
  it("is exactly SCORE_WINDOW_DAYS before now — the same span scoring uses", () => {
    expect(scoreEvidenceWindowStart(now).getTime()).toBe(now.getTime() - SCORE_WINDOW_DAYS * DAY);
  });
});

describe("classifyReliabilityScore", () => {
  it("is 'none' when no score has ever been computed, whatever the check count", () => {
    expect(classifyReliabilityScore({ latestScore: null, recentCheckCount: 0, now })).toBe("none");
    expect(classifyReliabilityScore({ latestScore: null, recentCheckCount: 50, now })).toBe("none");
  });

  it("is 'fresh' with enough recent checks and a score window ending inside the trailing window", () => {
    expect(
      classifyReliabilityScore({ latestScore: { windowEnd: at(DAY) }, recentCheckCount: 7, now }),
    ).toBe("fresh");
  });

  it("is 'stale' with exactly 4 qualifying checks", () => {
    expect(MIN_SAMPLES_FOR_SCORE).toBe(5);
    expect(
      classifyReliabilityScore({ latestScore: { windowEnd: at(DAY) }, recentCheckCount: 4, now }),
    ).toBe("stale");
  });

  it("is 'fresh' with exactly 5 qualifying checks", () => {
    expect(
      classifyReliabilityScore({ latestScore: { windowEnd: at(DAY) }, recentCheckCount: 5, now }),
    ).toBe("fresh");
  });

  it("counts a score window ending exactly at the 7-day boundary as fresh, and 1ms earlier as stale", () => {
    const boundary = scoreEvidenceWindowStart(now);
    expect(
      classifyReliabilityScore({ latestScore: { windowEnd: boundary }, recentCheckCount: 5, now }),
    ).toBe("fresh");
    expect(
      classifyReliabilityScore({
        latestScore: { windowEnd: new Date(boundary.getTime() - 1) },
        recentCheckCount: 5,
        now,
      }),
    ).toBe("stale");
  });

  it("stays fresh when checks continued after the score's window_end, within the trailing window", () => {
    expect(
      classifyReliabilityScore({ latestScore: { windowEnd: at(3 * DAY) }, recentCheckCount: 8, now }),
    ).toBe("fresh");
  });

  it("is stale when the score's window_end is older than the trailing window, even with plenty of recent checks", () => {
    expect(
      classifyReliabilityScore({ latestScore: { windowEnd: at(8 * DAY) }, recentCheckCount: 10, now }),
    ).toBe("stale");
  });
});
