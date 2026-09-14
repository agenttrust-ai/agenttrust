/**
 * A deterministic, explainable Reliability/Trust Score computed purely from
 * an agent's own accumulated health-check history (pull probes and push
 * heartbeats land in the same `health_checks` table, so this works
 * identically for either monitoring mode — it only ever looks at
 * `success`/`latencyMs`/`checkedAt`, never at `method`).
 *
 * No network access, no randomness, no wall-clock reads inside this module
 * — every input is passed in, so the same history always produces the same
 * score and the whole thing is trivially unit-testable.
 */

/** Below this many samples in the window, there isn't enough evidence to score at all — see `computeReliabilityScore`. */
export const MIN_SAMPLES_FOR_SCORE = 5;

/** How far back a score's window looks, in days. */
export const SCORE_WINDOW_DAYS = 7;

/** Below this average latency, latency scores the maximum; at/above the other, it scores zero. Linear in between. */
export const GOOD_LATENCY_MS = 500;
export const BAD_LATENCY_MS = 5000;

/**
 * Relative weight of each subscore in the blended average. Sums to 1 —
 * kept as named constants (rather than inlined) so the weighting is visible
 * in one place and the score stays explainable.
 */
export const SCORE_WEIGHTS = {
  uptime: 0.4,
  latency: 0.2,
  consistency: 0.15,
  incident: 0.25,
} as const;

/**
 * The blended average is additionally dampened by uptime: at 0% uptime the
 * average is scaled down to `UPTIME_FLOOR_FACTOR` of its unscaled value, at
 * 100% uptime it's left untouched. Uptime is already one of the four
 * weighted subscores, but a persistently-unavailable agent shouldn't be
 * able to buy back a respectable overall score just by also being
 * low-latency and "consistent" (i.e. consistently down) — nothing else
 * should be able to fully offset not actually being up.
 */
export const UPTIME_FLOOR_FACTOR = 0.4;

/** Bumped whenever the formula changes, so stored snapshots stay attributable to the rules that produced them. */
export const FORMULA_VERSION = "v1";

/**
 * Interpretation bands applied to an already-computed score — not part of
 * the formula above, and changing them never changes what a score *is*,
 * only how it's labeled/acted on downstream. Shared by the dashboard badge
 * (`ReliabilityScoreBadge`) and the Public API's trust-decision logic
 * (`src/lib/reliability/trust-decision.ts`) so the two never quietly drift
 * apart into different opinions about what counts as "good enough".
 */
export const SCORE_THRESHOLD_HIGH_CONFIDENCE = 90;
export const SCORE_THRESHOLD_RECOMMENDED = 50;

export type ScoredCheck = {
  checkedAt: Date;
  success: boolean;
  latencyMs: number | null;
};

export type ReliabilityScore = {
  score: number;
  uptimeSubscore: number;
  latencySubscore: number;
  consistencySubscore: number;
  incidentSubscore: number;
  sampleSize: number;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function scoreUptime(checks: ScoredCheck[]): number {
  const successCount = checks.filter((c) => c.success).length;
  return round2((100 * successCount) / checks.length);
}

function scoreLatency(checks: ScoredCheck[]): number {
  const latencies = checks
    .map((c) => c.latencyMs)
    .filter((ms): ms is number => ms !== null);

  // No latency evidence at all (e.g. a push-only history — heartbeats don't
  // measure round-trip latency) — neutral, not a penalty for data that was
  // never applicable to begin with.
  if (latencies.length === 0) return 100;

  const avg = latencies.reduce((sum, ms) => sum + ms, 0) / latencies.length;
  if (avg <= GOOD_LATENCY_MS) return 100;
  if (avg >= BAD_LATENCY_MS) return 0;

  const fraction = (BAD_LATENCY_MS - avg) / (BAD_LATENCY_MS - GOOD_LATENCY_MS);
  return round2(100 * fraction);
}

/** Chronological (oldest-first) is required by the caller — see `computeReliabilityScore`. */
function scoreConsistency(checksChronological: ScoredCheck[]): number {
  if (checksChronological.length < 2) return 100;

  let transitions = 0;
  for (let i = 1; i < checksChronological.length; i++) {
    if (checksChronological[i].success !== checksChronological[i - 1].success) {
      transitions++;
    }
  }
  const maxTransitions = checksChronological.length - 1;
  return round2(100 * (1 - transitions / maxTransitions));
}

/** Chronological (oldest-first) is required by the caller — see `computeReliabilityScore`. */
function scoreIncident(checksChronological: ScoredCheck[]): number {
  let longestFailureRun = 0;
  let currentRun = 0;
  for (const check of checksChronological) {
    currentRun = check.success ? 0 : currentRun + 1;
    if (currentRun > longestFailureRun) longestFailureRun = currentRun;
  }

  const fraction = longestFailureRun / checksChronological.length;
  return round2(clamp(100 * (1 - fraction), 0, 100));
}

/**
 * Returns `null` when there isn't enough history to justify any score —
 * callers must treat `null` as "insufficient data", never as (or rounded
 * to) a numeric score, and never default a new or rarely-checked agent to
 * a high trust score just because nothing bad has been observed yet.
 *
 * `checks` may be given in any order; this sorts internally.
 */
export function computeReliabilityScore(checks: ScoredCheck[]): ReliabilityScore | null {
  if (checks.length < MIN_SAMPLES_FOR_SCORE) return null;

  const chronological = [...checks].sort(
    (a, b) => a.checkedAt.getTime() - b.checkedAt.getTime(),
  );

  const uptimeSubscore = scoreUptime(chronological);
  const latencySubscore = scoreLatency(chronological);
  const consistencySubscore = scoreConsistency(chronological);
  const incidentSubscore = scoreIncident(chronological);

  const weightedAverage =
    SCORE_WEIGHTS.uptime * uptimeSubscore +
    SCORE_WEIGHTS.latency * latencySubscore +
    SCORE_WEIGHTS.consistency * consistencySubscore +
    SCORE_WEIGHTS.incident * incidentSubscore;

  const uptimeFloorMultiplier =
    UPTIME_FLOOR_FACTOR + (1 - UPTIME_FLOOR_FACTOR) * (uptimeSubscore / 100);

  return {
    score: round2(clamp(weightedAverage * uptimeFloorMultiplier, 0, 100)),
    uptimeSubscore,
    latencySubscore,
    consistencySubscore,
    incidentSubscore,
    sampleSize: checks.length,
  };
}
