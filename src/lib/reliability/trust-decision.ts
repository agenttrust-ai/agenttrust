import type { AgentHealthStatus } from "@/lib/monitoring/status";
import {
  MIN_SAMPLES_FOR_SCORE,
  SCORE_THRESHOLD_HIGH_CONFIDENCE,
  SCORE_THRESHOLD_RECOMMENDED,
  SCORE_WINDOW_DAYS,
} from "./scoring";
import type { ReliabilityScoreStatus } from "./freshness";

/** The `reasons` entry for a historical score that current evidence no longer supports. */
export const STALE_SCORE_REASON = `Reliability score is out of date: fewer than ${MIN_SAMPLES_FOR_SCORE} health checks in the last ${SCORE_WINDOW_DAYS} days, so it no longer counts as current evidence.`;

/**
 * A deterministic decision layer on top of already-existing trust signals —
 * never a second scoring model. Every input here (`status`, `score`,
 * `verified`) is computed elsewhere by code that already exists; this
 * module only interprets that data, so the same three inputs always
 * produce the same decision, and the decision is fully explainable by
 * `reasons` alone.
 *
 * Health/reliability remain the primary signal on purpose: `recommended`
 * is driven by `status` + `score` alone. Ownership verification is real
 * evidence, not decoration, but it's deliberately not a hard gate — an
 * unverified agent with strong health/reliability history can still be
 * `recommended`. Verification instead moves `confidence`, and is always
 * exposed as its own explicit field (both directly, via the caller's
 * existing `verified`/`ownershipVerifiedAt` fields, and implicitly via a
 * `reasons` entry when absent) — a stricter external caller that wants to
 * *require* verification can filter on that field itself without
 * AgentTrust having to bake that policy in for everyone.
 */

export type TrustConfidence = "high" | "medium" | "low" | "insufficient_data";

export type TrustDecision = {
  recommended: boolean;
  confidence: TrustConfidence;
  reasons: string[];
};

export type TrustDecisionInput = {
  status: AgentHealthStatus;
  /** `null` means no reliability score has been computed yet (insufficient monitoring history) — see `computeReliabilityScore`. */
  score: number | null;
  verified: boolean;
  /**
   * Freshness of `score` (see `classifyReliabilityScore`). A `stale` score
   * is treated exactly like no score: never enough for `recommended`, and
   * `confidence` is `insufficient_data`. Omitted, it's inferred from
   * `score` alone (`null` → none, a number → fresh) — the behavior before
   * freshness existed.
   */
  scoreStatus?: ReliabilityScoreStatus;
};

export function computeTrustDecision({
  status,
  score: rawScore,
  verified,
  scoreStatus,
}: TrustDecisionInput): TrustDecision {
  const reasons: string[] = [];
  const isStale = scoreStatus === "stale" && rawScore !== null;
  // Only current evidence counts toward the decision; a stale historical
  // score is still returned to callers, just never acted on here.
  const score = isStale ? null : rawScore;

  if (status !== "healthy") {
    reasons.push(`Current status is "${status}", not healthy.`);
  }
  if (isStale) {
    reasons.push(STALE_SCORE_REASON);
  } else if (score === null) {
    reasons.push("Not enough monitoring history yet to compute a reliability score.");
  } else if (score < SCORE_THRESHOLD_RECOMMENDED) {
    reasons.push(`Reliability score is low (${score.toFixed(0)}/100).`);
  }
  if (!verified) {
    reasons.push("Endpoint ownership has not been verified.");
  }

  const recommended =
    status === "healthy" && score !== null && score >= SCORE_THRESHOLD_RECOMMENDED;

  const confidence: TrustConfidence =
    score === null
      ? "insufficient_data"
      : !verified
        ? "low"
        : score >= SCORE_THRESHOLD_HIGH_CONFIDENCE
          ? "high"
          : score >= SCORE_THRESHOLD_RECOMMENDED
            ? "medium"
            : "low";

  return { recommended, confidence, reasons };
}
