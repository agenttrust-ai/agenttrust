import type { StatusTone } from "@/components/ui/status-chip";

/** The `trustDecision` shape `check_agent_trust` and the REST lookup return. */
export type TrustDecisionView = {
  recommended: boolean;
  confidence: "high" | "medium" | "low" | "insufficient_data";
  reasons: string[];
};

export type VerdictKind = "recommended" | "not_recommended" | "insufficient_data";

export type Verdict = {
  kind: VerdictKind;
  label: string;
  tone: StatusTone;
};

/**
 * Presentation only — derived purely from the backend's own `trustDecision`
 * fields, never a new rule. `insufficient_data` is its own neutral state,
 * not folded into "not recommended": AgentTrust genuinely doesn't have
 * current evidence either way.
 */
export function verdictOf(decision: TrustDecisionView): Verdict {
  if (decision.confidence === "insufficient_data") {
    return { kind: "insufficient_data", label: "Insufficient data", tone: "neutral" };
  }
  if (decision.recommended) {
    return { kind: "recommended", label: "Recommended", tone: "positive" };
  }
  return { kind: "not_recommended", label: "Not recommended", tone: "negative" };
}

/** How the backend's `reasons` list should be framed for each verdict. */
export function reasonsHeading(kind: VerdictKind, reasonCount: number): string {
  if (kind === "not_recommended") return "Why it isn't recommended";
  if (kind === "insufficient_data") return "Why there isn't enough evidence";
  return reasonCount > 0 ? "What limits confidence" : "No caveats reported";
}

export const CONFIDENCE_LEVELS = ["insufficient_data", "low", "medium", "high"] as const;

export const CONFIDENCE_LABEL: Record<TrustDecisionView["confidence"], string> = {
  insufficient_data: "Insufficient data",
  low: "Low",
  medium: "Medium",
  high: "High",
};
