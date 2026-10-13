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
