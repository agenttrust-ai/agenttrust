import { MIN_SAMPLES_FOR_SCORE, SCORE_WINDOW_DAYS } from "./scoring";

/**
 * Whether an agent's latest stored reliability score still reflects current
 * evidence:
 *
 *   - `none`  — no score has ever been computed.
 *   - `fresh` — the agent has at least MIN_SAMPLES_FOR_SCORE health checks
 *               in the trailing SCORE_WINDOW_DAYS right now (the exact bar
 *               the scoring formula needs to compute any score), and the
 *               latest score's own window ends inside that trailing window.
 *   - `stale` — a score exists, but current evidence no longer meets that
 *               bar. The historical value is kept and still returned, but
 *               must never be read as current evidence.
 *
 * No separate age threshold: under daily monitoring an agent holds ~7
 * checks in the window, so a score survives two missed runs and goes stale
 * on the third — and under sparser monitoring it goes stale as soon as a
 * fresh score couldn't be computed anyway.
 */
export type ReliabilityScoreStatus = "none" | "fresh" | "stale";

export const RELIABILITY_SCORE_STATUSES = ["none", "fresh", "stale"] as const;

/** Start of the trailing evidence window ending at `now` — the same span `computeAndStoreReliabilityScore` scores over. */
export function scoreEvidenceWindowStart(now: Date): Date {
  return new Date(now.getTime() - SCORE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

export function classifyReliabilityScore(input: {
  /** The latest stored score, or `null` if none has ever been computed. */
  latestScore: { windowEnd: Date } | null;
  /** Health checks with `checked_at` in [scoreEvidenceWindowStart(now), now]. */
  recentCheckCount: number;
  now: Date;
}): ReliabilityScoreStatus {
  if (!input.latestScore) return "none";
  if (input.recentCheckCount < MIN_SAMPLES_FOR_SCORE) return "stale";
  if (input.latestScore.windowEnd < scoreEvidenceWindowStart(input.now)) return "stale";
  return "fresh";
}
