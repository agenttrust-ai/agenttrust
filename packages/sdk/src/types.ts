/**
 * Mirrors the output schema of AgentTrust's `check_agent_trust` MCP tool
 * (https://getagenttrust.com/api/mcp/public, `tools/list`). Additive fields
 * the server may add later are ignored, never an error.
 */

export type AgentStatus = "unknown" | "healthy" | "degraded" | "down";

/** Whether `reliabilityScore` is current evidence. A stale score never makes an agent recommended. */
export type ReliabilityScoreStatus = "none" | "fresh" | "stale";

export type TrustConfidence = "high" | "medium" | "low" | "insufficient_data";

export interface TrustDecision {
  /** AgentTrust's recommendation, derived only from status, reliability score, freshness and verification. */
  recommended: boolean;
  confidence: TrustConfidence;
  /** Plain-language reasons for everything that counted against the agent; empty when nothing did. */
  reasons: string[];
}

/** An endpoint AgentTrust monitors. */
export interface MatchedTrustResult {
  matched: true;
  slug: string;
  name: string;
  status: AgentStatus;
  /** Whether the endpoint's owner has proven control of its origin. */
  verified: boolean;
  /** 0–100, or null before there is enough monitoring history. */
  reliabilityScore: number | null;
  reliabilityScoreStatus: ReliabilityScoreStatus;
  trustDecision: TrustDecision;
}

export type ObservationStatus = "pending" | "observing" | "not_in_registry";

/** An endpoint AgentTrust has no data for. Never carries a score or verification. */
export interface UnmatchedTrustResult {
  matched: false;
  /** Present when AgentTrust queued or resolved this endpoint for observation. */
  observation?: { status: ObservationStatus; message: string };
}

export type TrustCheckResult = MatchedTrustResult | UnmatchedTrustResult;

export interface TrustPolicy {
  /** Require AgentTrust's own `trustDecision.recommended`. Default: true. */
  requireRecommended?: boolean;
  /** Minimum `trustDecision.confidence`. Default: none. */
  minConfidence?: "low" | "medium" | "high";
  /** Require endpoint-ownership verification. Default: false. */
  requireVerified?: boolean;
  /** Minimum reliability score (0–100); a missing or stale score fails it. Default: none. */
  minReliabilityScore?: number;
  /** Accept an endpoint AgentTrust has no data for. Default: false (fail closed). */
  allowUnknown?: boolean;
}

export interface AgentTrustClientOptions {
  /** MCP endpoint to call. Default: https://getagenttrust.com/api/mcp/public (no API key needed). */
  endpoint?: string;
  /** Per-request timeout in milliseconds. Default: 10000. */
  timeoutMs?: number;
  /** A `fetch` implementation. Default: the global `fetch`. */
  fetch?: typeof fetch;
  /** Sent as the User-Agent header. Default: "agenttrust-sdk/<version>". */
  userAgent?: string;
}

export interface CheckOptions {
  /** Overrides the client's timeout for this call. */
  timeoutMs?: number;
  /** Aborts the request. */
  signal?: AbortSignal;
}

/** What `assessAgent` decided. Reachability is not safety: `allow_with_caution` never means the agent's behavior is safe. */
export type AssessmentDecision =
  "allow_with_caution" | "avoid" | "insufficient_evidence";

/** How strongly the evidence supports the decision. `none` comes with `insufficient_evidence`. */
export type AssessmentConfidence = "high" | "medium" | "low" | "none";

export type ReachabilityOutcome =
  "reachable" | "unreachable" | "timeout" | "blocked" | "not_checked";

export type InitialRiskLevel =
  "low" | "moderate" | "elevated" | "high" | "unknown";

/** The result of `assessAgent`, as returned by AgentTrust's `assess_agent` tool. */
export interface AgentAssessment {
  assessmentVersion: string;
  /** "cached": built only from AgentTrust's stored observations. */
  mode: string;
  status: string;
  matched: boolean;
  decision: AssessmentDecision;
  confidence: AssessmentConfidence;
  /** Machine-readable reasons, e.g. "UNKNOWN_ENDPOINT", "FEW_OBSERVATIONS", "OWNERSHIP_UNVERIFIED". New codes may be added. */
  reasonCodes: string[];
  reachability: {
    outcome: ReachabilityOutcome;
    checkStatus: string | null;
    httpStatus: number | null;
    latencyMs: number | null;
    checkedAt: string | null;
    ageSeconds: number | null;
    fresh: boolean;
    source: string | null;
  };
  initialRisk: {
    level: InitialRiskLevel;
    observations: {
      attempts: number;
      successful: number;
      successfulStreak: number;
      streakSpanMinutes: number;
    };
  };
  /** The existing reliability score and trustDecision, unchanged. Null when unmatched. */
  historical: {
    status: AgentStatus;
    reliabilityScore: number | null;
    reliabilityScoreStatus: ReliabilityScoreStatus;
    reliabilityScoreComputedAt: string | null;
    trustDecision: TrustDecision;
  } | null;
  agent: {
    slug: string;
    name: string;
    source: string;
    verified: boolean;
    registeredAt: string;
  } | null;
  /** What this assessment does not show. The first entry always states that reachability is not safety. */
  limitations: string[];
  freshness: {
    assessedAt: string;
    evidenceAgeSeconds: number | null;
    evidenceExpiresAt: string | null;
  };
}
