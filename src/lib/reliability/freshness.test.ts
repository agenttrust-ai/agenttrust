import { describe, expect, it } from "vitest";
import {
  SCORE_MAX_AGE_HOURS,
  SCORE_MAX_AGE_MS,
  SCORE_SETTLE_MINUTES,
  SCORE_SETTLE_MS,
  classifyReliabilityScore,
} from "./freshness";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A score written by a check at `windowEnd` — scoring sets windowEnd = that check's checkedAt. */
const scored = (windowEnd: Date) => ({ latestScore: { windowEnd }, latestCheckAt: windowEnd });
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);

describe("freshness constants", () => {
  it("allow one missed daily run (plus cron-hour jitter) and settle for 10 minutes", () => {
    expect(SCORE_MAX_AGE_HOURS).toBe(50);
    expect(SCORE_MAX_AGE_MS).toBe(50 * HOUR);
    expect(SCORE_SETTLE_MINUTES).toBe(10);
    expect(SCORE_SETTLE_MS).toBe(10 * MINUTE);
  });
});

describe("classifyReliabilityScore", () => {
  const run = new Date("2026-09-27T00:44:10.000Z");

  it("is 'none' when no score has ever been computed, whatever the checks", () => {
    expect(classifyReliabilityScore({ latestScore: null, latestCheckAt: null, now: run })).toBe("none");
    expect(classifyReliabilityScore({ latestScore: null, latestCheckAt: run, now: run })).toBe("none");
  });

  it("is 'fresh' immediately after computation", () => {
    expect(classifyReliabilityScore({ ...scored(run), now: run })).toBe("fresh");
  });

  it("stays 'fresh' 23h59m later, with no new check — however old its oldest sample has become", () => {
    expect(classifyReliabilityScore({ ...scored(run), now: plus(run, DAY - MINUTE) })).toBe("fresh");
  });

  it("is deterministic at the 50-hour boundary: exactly 50h is fresh, 1ms later is stale", () => {
    expect(classifyReliabilityScore({ ...scored(run), now: plus(run, SCORE_MAX_AGE_MS) })).toBe("fresh");
    expect(classifyReliabilityScore({ ...scored(run), now: plus(run, SCORE_MAX_AGE_MS + 1) })).toBe("stale");
  });

  it("is 'stale' once older than the maximum age — monitoring stopped refreshing it", () => {
    expect(classifyReliabilityScore({ ...scored(run), now: plus(run, 3 * DAY) })).toBe("stale");
    expect(classifyReliabilityScore({ ...scored(run), now: plus(run, 8 * DAY) })).toBe("stale");
  });

  it("doesn't flicker to 'stale' while a newer check's score is still being written", () => {
    const newerCheck = plus(run, DAY);
    for (const since of [0, 1, 1000, SCORE_SETTLE_MS - 1]) {
      expect(
        classifyReliabilityScore({
          latestScore: { windowEnd: run },
          latestCheckAt: newerCheck,
          now: plus(newerCheck, since),
        }),
      ).toBe("fresh");
    }
  });

  it("is 'stale' once a newer check is at least 10 minutes old without having produced a score", () => {
    const newerCheck = plus(run, DAY);
    expect(
      classifyReliabilityScore({
        latestScore: { windowEnd: run },
        latestCheckAt: newerCheck,
        now: plus(newerCheck, SCORE_SETTLE_MS),
      }),
    ).toBe("stale");
    expect(
      classifyReliabilityScore({
        latestScore: { windowEnd: run },
        latestCheckAt: newerCheck,
        now: plus(newerCheck, 12 * HOUR),
      }),
    ).toBe("stale");
  });

  it("treats a check at exactly the score's windowEnd as the one that produced it", () => {
    expect(
      classifyReliabilityScore({ latestScore: { windowEnd: run }, latestCheckAt: run, now: plus(run, 12 * HOUR) }),
    ).toBe("fresh");
  });

  it("can't change between two daily runs: the same answer at every minute until the next check", () => {
    const states = new Set<string>();
    for (let t = 0; t < DAY; t += MINUTE) {
      states.add(classifyReliabilityScore({ ...scored(run), now: plus(run, t) }));
    }
    expect([...states]).toEqual(["fresh"]);
  });
});
