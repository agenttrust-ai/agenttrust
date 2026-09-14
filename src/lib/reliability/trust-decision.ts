import type { AgentHealthStatus } from "@/lib/monitoring/status";
import {
  SCORE_THRESHOLD_HIGH_CONFIDENCE,
  SCORE_THRESHOLD_RECOMMENDED,
} from "./scoring";

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
};

export function computeTrustDecision({
  status,
  score,
  verified,
}: TrustDecisionInput): TrustDecision {
  const reasons: string[] = [];

  if (status !== "healthy") {
    reasons.push(`Current status is "${status}", not healthy.`);
  }
  if (score === null) {
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
