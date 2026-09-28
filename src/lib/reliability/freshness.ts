/**
 * Whether an agent's latest stored reliability score still reflects current
 * evidence:
 *
 *   - `none`  — no score has ever been computed.
 *   - `fresh` — the latest score was produced by the agent's most recent
 *               observation, and that was recent enough.
 *   - `stale` — a score exists, but it no longer reflects current
 *               evidence. The historical value is kept and still returned,
 *               but must never be read as current evidence.
 *
 * Freshness is anchored to observations, never to the clock sliding a
 * window: a score is stored only when its own trailing window
 * (`SCORE_WINDOW_DAYS`) held at least `MIN_SAMPLES_FOR_SCORE` checks — see
 * `computeAndStoreReliabilityScore` — and its `windowEnd` is exactly the
 * `checkedAt` of the check that produced it. So that bar is already proven
 * for every stored score; it isn't re-counted at read time. Re-counting a
 * window ending at the read time made a score go stale seconds after it
 * was computed, whenever its oldest sample was about to age out — with no
 * new evidence either way, and depending on seconds of cron timing.
 *
 * A score is stale when either:
 *
 *   1. It's older than `SCORE_MAX_AGE_MS` — monitoring has stopped
 *      refreshing it (e.g. missed runs, or an agent no longer checked).
 *   2. A newer health check exists, at least `SCORE_SETTLE_MS` old, that
 *      didn't produce a replacement score — the latest observation no
 *      longer had enough evidence to score, or scoring failed.
 *
 * Both depend only on stored timestamps, so between two monitoring runs a
 * score's status can't change: it's decided when a check or score is
 * written, and by the age limit.
 */
export type ReliabilityScoreStatus = "none" | "fresh" | "stale";

export const RELIABILITY_SCORE_STATUSES = ["none", "fresh", "stale"] as const;

const HOUR_MS = 60 * 60 * 1000;

/**
 * Longest a score counts as current without being replaced. Scores are
 * refreshed by the daily health-check cron; Vercel may fire it anywhere in
 * its scheduled hour, so two consecutive runs can be up to ~25h apart.
 * 50h = two such intervals: a score survives one missed run and goes
 * stale during the second.
 */
export const SCORE_MAX_AGE_HOURS = 50;
export const SCORE_MAX_AGE_MS = SCORE_MAX_AGE_HOURS * HOUR_MS;

/**
 * How long a newer check may exist before it counts as "didn't produce a
 * score". Covers the moment between writing a check and writing the score
 * it produces (normally well under a second), so a lookup landing in that
 * gap never sees a flicker of `stale`.
 */
export const SCORE_SETTLE_MINUTES = 10;
export const SCORE_SETTLE_MS = SCORE_SETTLE_MINUTES * 60 * 1000;

export function classifyReliabilityScore(input: {
  /** The latest stored score, or `null` if none has ever been computed. */
  latestScore: { windowEnd: Date } | null;
  /** `checkedAt` of the agent's most recent health check (pull or push), or `null` if none. */
  latestCheckAt: Date | null;
  now: Date;
}): ReliabilityScoreStatus {
  const { latestScore, latestCheckAt, now } = input;
  if (!latestScore) return "none";

  const windowEnd = latestScore.windowEnd.getTime();
  if (now.getTime() - windowEnd > SCORE_MAX_AGE_MS) return "stale";

  if (
    latestCheckAt &&
    latestCheckAt.getTime() > windowEnd &&
    now.getTime() - latestCheckAt.getTime() >= SCORE_SETTLE_MS
  ) {
    return "stale";
  }

  return "fresh";
}
