import type { AgentHealthStatus } from "@/lib/monitoring/status";
import type { CheckStatus } from "@/lib/monitoring/safe-fetch";
import type { ReliabilityScoreStatus } from "@/lib/reliability/freshness";
import { SCORE_MAX_AGE_HOURS } from "@/lib/reliability/freshness";
import type { TrustDecision } from "@/lib/reliability/trust-decision";

/**
 * Agent assessment: an immediate use-or-avoid decision for an AI agent about
 * to call another agent, kept apart from — and never feeding back into — the
 * historical reliability score and `trustDecision`.
 *
 * Three layers, reported separately:
 *   - reachability: the latest stored observation of the endpoint;
 *   - initialRisk: a rule-based risk level from the evidence on hand;
 *   - historical: the existing score and trustDecision, unchanged.
 *
 * Pure: no database, no network. In this phase every observation is one of
 * AgentTrust's own scheduled health checks, read from storage — nothing here
 * ever contacts the endpoint being assessed.
 *
 * The rules never let reachability stand in for safety: a single successful
 * observation is never enough for `allow_with_caution`, and every result
 * carries `limitations` saying what reachability doesn't show.
 */

export const ASSESSMENT_VERSION = "1";

export const ASSESSMENT_DECISIONS = [
  "allow_with_caution",
  "avoid",
  "insufficient_evidence",
] as const;
export type AssessmentDecision = (typeof ASSESSMENT_DECISIONS)[number];

/** How strongly the evidence supports the decision. `none` only with `insufficient_evidence`. */
export const ASSESSMENT_CONFIDENCES = [
  "high",
  "medium",
  "low",
  "none",
] as const;
export type AssessmentConfidence = (typeof ASSESSMENT_CONFIDENCES)[number];

export const REACHABILITY_OUTCOMES = [
  "reachable",
  "unreachable",
  "timeout",
  "blocked",
  "not_checked",
] as const;
export type ReachabilityOutcome = (typeof REACHABILITY_OUTCOMES)[number];

export const INITIAL_RISK_LEVELS = [
  "low",
  "moderate",
  "elevated",
  "high",
  "unknown",
] as const;
export type InitialRiskLevel = (typeof INITIAL_RISK_LEVELS)[number];

export const REASON_CODES = [
  "UNKNOWN_ENDPOINT",
  "NOT_YET_CHECKED",
  "REACHABLE_AT_LAST_CHECK",
  "UNREACHABLE_AT_LAST_CHECK",
  "LAST_CHECK_TIMEOUT",
  "LAST_CHECK_DNS_ERROR",
  "LAST_CHECK_CONNECTION_ERROR",
  "LAST_CHECK_BLOCKED",
  "LAST_CHECK_TLS_ERROR",
  "LAST_CHECK_HTTP_ERROR",
  "TRANSIENT_NETWORK_FAILURE",
  "ENDPOINT_ERROR_RESPONSE",
  "PERSISTENT_FAILURE",
  "RECOVERING",
  "NO_RECENT_LIVE_CHECK",
  "STALE_EVIDENCE",
  "FEW_OBSERVATIONS",
  "INITIAL_OBSERVATIONS_ONLY",
  "SUFFICIENT_HISTORY",
  "NO_HISTORICAL_SCORE",
  "HISTORICAL_SCORE_STALE",
  "HISTORICAL_SCORE_LOW",
  "HISTORICAL_STATUS_DOWN",
  "HISTORICAL_STATUS_DEGRADED",
  "OWNERSHIP_VERIFIED",
  "OWNERSHIP_UNVERIFIED",
  "EXTERNALLY_OBSERVED",
  "RECENTLY_REGISTERED",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

/** Two independent successful observations at least this far apart are the minimum for `allow_with_caution` without history. */
export const MIN_SUCCESSFUL_OBSERVATIONS = 2;
export const MIN_OBSERVATION_SPAN_MS = 10 * 60 * 1000;
/** An observation newer than this counts as "fresh" reachability. */
export const REACHABILITY_FRESH_MAX_AGE_SECONDS = 15 * 60;
/** Evidence older than this is too old to decide on — the same 50 hours after which a score goes stale. */
export const EVIDENCE_MAX_AGE_HOURS = SCORE_MAX_AGE_HOURS;
/** An agent registered (or first observed) within this many hours gets RECENTLY_REGISTERED. */
export const RECENTLY_REGISTERED_HOURS = 24;

const HISTORICAL_SCORE_MIN = 50;

/** Shown on every assessment, first: what reachability does not prove. */
export const REACHABILITY_IS_NOT_SAFETY =
  "Reachability is not safety: AgentTrust only observes whether the endpoint answers HTTP requests. It does not inspect the agent's behavior, outputs, data handling, or security.";
export const CACHED_EVIDENCE_LIMITATION =
  "This assessment uses AgentTrust's stored observations; no live request was made to the endpoint for it.";

export type AssessmentObservation = {
  checkedAt: Date;
  success: boolean;
  checkStatus: CheckStatus;
  httpStatus: number | null;
  latencyMs: number | null;
};

export type AssessmentAgentEvidence = {
  slug: string;
  name: string;
  source: "owner_registered" | "externally_observed";
  verified: boolean;
  /** When the agent entered AgentTrust (registered, or first observed). */
  registeredAt: Date;
  historical: {
    status: AgentHealthStatus;
    reliabilityScore: number | null;
    reliabilityScoreStatus: ReliabilityScoreStatus;
    reliabilityScoreComputedAt: Date | null;
    /** Exactly the trustDecision the rest of the API returns for this agent. */
    trustDecision: TrustDecision;
  };
};

export type AssessmentInput = {
  now: Date;
  /** Null when AgentTrust has no public, active agent at this endpoint. */
  agent: AssessmentAgentEvidence | null;
  /** The agent's stored observations, newest first. */
  observations: AssessmentObservation[];
};

export type AgentAssessment = {
  assessmentVersion: typeof ASSESSMENT_VERSION;
  /** Always "cached" in this phase: built only from stored evidence. */
  mode: "cached";
  status: "complete";
  matched: boolean;
  decision: AssessmentDecision;
  confidence: AssessmentConfidence;
  reasonCodes: ReasonCode[];
  reachability: {
    outcome: ReachabilityOutcome;
    checkStatus: CheckStatus | null;
    httpStatus: number | null;
    latencyMs: number | null;
    checkedAt: string | null;
    ageSeconds: number | null;
    fresh: boolean;
    source: "scheduled_check" | null;
  };
  initialRisk: {
    level: InitialRiskLevel;
    observations: {
      /** Stored observations considered (newest first, at most the last 7 days). */
      attempts: number;
      successful: number;
      /** Consecutive successes up to and including the latest observation. */
      successfulStreak: number;
      /** Minutes between the oldest and newest observation in that streak. */
      streakSpanMinutes: number;
    };
  };
  historical: {
    status: AgentHealthStatus;
    reliabilityScore: number | null;
    reliabilityScoreStatus: ReliabilityScoreStatus;
    reliabilityScoreComputedAt: string | null;
    trustDecision: TrustDecision;
  } | null;
  agent: {
    slug: string;
    name: string;
    source: "owner_registered" | "externally_observed";
    verified: boolean;
    registeredAt: string;
  } | null;
  limitations: string[];
  freshness: {
    assessedAt: string;
    evidenceAgeSeconds: number | null;
    /** After this, the evidence is too old to decide on (STALE_EVIDENCE). */
    evidenceExpiresAt: string | null;
  };
};

function outcomeFor(observation: AssessmentObservation): ReachabilityOutcome {
  if (observation.success) return "reachable";
  if (observation.checkStatus === "timeout") return "timeout";
  if (observation.checkStatus === "ssrf_blocked") return "blocked";
  return "unreachable";
}

function failureReason(observation: AssessmentObservation): ReasonCode | null {
  switch (observation.checkStatus) {
    case "timeout":
      return "LAST_CHECK_TIMEOUT";
    case "dns_error":
      return "LAST_CHECK_DNS_ERROR";
    case "connection_error":
      return "LAST_CHECK_CONNECTION_ERROR";
    case "ssrf_blocked":
      return "LAST_CHECK_BLOCKED";
    case "tls_error":
      return "LAST_CHECK_TLS_ERROR";
    case "http_error":
      return "LAST_CHECK_HTTP_ERROR";
    default:
      return null;
  }
}

/**
 * How much one failed observation says on its own.
 *   - deterministic: the same URL fails the same way every time (a TLS
 *     failure, or the endpoint resolving or redirecting into a private or
 *     internal network) — the monitor's retry policy treats these the same
 *     way. Clear enough to avoid.
 *   - endpoint_error: the endpoint answered, with an error status (400, 404,
 *     5xx…). Real, but one response can still be a blip.
 *   - transient: a timeout, DNS or connection failure — the kind of thing
 *     that clears up on its own.
 * Only a run of failures, never a single non-deterministic one, makes an
 * endpoint "persistently failing".
 */
type FailureKind = "deterministic" | "endpoint_error" | "transient";

function failureKind(observation: AssessmentObservation): FailureKind {
  switch (observation.checkStatus) {
    case "tls_error":
    case "ssrf_blocked":
      return "deterministic";
    case "http_error":
      return "endpoint_error";
    default:
      return "transient";
  }
}

/** Consecutive failures that make a failure persistent rather than a blip. */
export const PERSISTENT_FAILURE_MIN = 2;
/** The same run of failures that marks an agent `down` (see src/lib/monitoring/status.ts). */
const LONG_FAILURE_RUN = 4;

function describeAge(seconds: number): string {
  if (seconds < 120) return `${seconds} seconds`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) return `${minutes} minutes`;
  return `${Math.round(minutes / 60)} hours`;
}

export function assessAgent(input: AssessmentInput): AgentAssessment {
  const { now, agent } = input;
  const observations = agent ? input.observations : [];
  const latest = observations[0] ?? null;

  const reasons: ReasonCode[] = [];
  const limitations: string[] = [REACHABILITY_IS_NOT_SAFETY];

  // Consecutive successes from the newest observation back to the first failure.
  let successfulStreak = 0;
  while (
    successfulStreak < observations.length &&
    observations[successfulStreak].success
  ) {
    successfulStreak++;
  }
  // Consecutive failures from the newest observation back to the first success.
  let failureStreak = 0;
  while (
    failureStreak < observations.length &&
    !observations[failureStreak].success
  ) {
    failureStreak++;
  }
  const streakSpanMs =
    successfulStreak >= 2
      ? observations[0].checkedAt.getTime() -
        observations[successfulStreak - 1].checkedAt.getTime()
      : 0;

  const ageSeconds = latest
    ? Math.max(
        0,
        Math.floor((now.getTime() - latest.checkedAt.getTime()) / 1000),
      )
    : null;
  const fresh =
    ageSeconds !== null && ageSeconds <= REACHABILITY_FRESH_MAX_AGE_SECONDS;
  const stale =
    ageSeconds !== null && ageSeconds > EVIDENCE_MAX_AGE_HOURS * 3600;

  let decision: AssessmentDecision;
  let confidence: AssessmentConfidence;
  let riskLevel: InitialRiskLevel;

  if (!agent) {
    reasons.push("UNKNOWN_ENDPOINT");
    limitations.push(
      "AgentTrust has no record of this endpoint, so nothing about it has been observed.",
    );
    decision = "insufficient_evidence";
    confidence = "none";
    riskLevel = "unknown";
  } else {
    const { historical } = agent;
    // Context that applies whatever the decision.
    reasons.push(
      agent.verified ? "OWNERSHIP_VERIFIED" : "OWNERSHIP_UNVERIFIED",
    );
    if (!agent.verified) {
      limitations.push(
        "Endpoint ownership is not verified: nobody has proven control of this endpoint to AgentTrust.",
      );
    }
    if (agent.source === "externally_observed") {
      reasons.push("EXTERNALLY_OBSERVED");
      limitations.push(
        "This agent was discovered from a public registry; nobody has claimed it.",
      );
    }
    if (
      now.getTime() - agent.registeredAt.getTime() <
      RECENTLY_REGISTERED_HOURS * 3600 * 1000
    ) {
      reasons.push("RECENTLY_REGISTERED");
    }
    if (historical.reliabilityScoreStatus === "none")
      reasons.push("NO_HISTORICAL_SCORE");
    if (historical.reliabilityScoreStatus === "stale")
      reasons.push("HISTORICAL_SCORE_STALE");
    const freshScore =
      historical.reliabilityScoreStatus === "fresh"
        ? historical.reliabilityScore
        : null;
    if (freshScore !== null && freshScore < HISTORICAL_SCORE_MIN)
      reasons.push("HISTORICAL_SCORE_LOW");
    if (historical.status === "down") reasons.push("HISTORICAL_STATUS_DOWN");
    if (historical.status === "degraded")
      reasons.push("HISTORICAL_STATUS_DEGRADED");

    if (latest) {
      if (latest.success) {
        reasons.push("REACHABLE_AT_LAST_CHECK");
      } else {
        reasons.push("UNREACHABLE_AT_LAST_CHECK");
        const specific = failureReason(latest);
        if (specific) reasons.push(specific);
      }
      if (!fresh) reasons.push("NO_RECENT_LIVE_CHECK");
      limitations.push(CACHED_EVIDENCE_LIMITATION);
      limitations.push(
        `The most recent observation is ${describeAge(ageSeconds ?? 0)} old.`,
      );
    }

    if (!latest) {
      reasons.push("NOT_YET_CHECKED");
      limitations.push("AgentTrust has not checked this endpoint yet.");
      decision = "insufficient_evidence";
      confidence = "none";
      riskLevel = "unknown";
    } else if (stale) {
      reasons.push("STALE_EVIDENCE");
      decision = "insufficient_evidence";
      confidence = "none";
      riskLevel = "unknown";
    } else if (historical.status === "down" && !latest.success) {
      // Still failing after the run of failures that marked it down.
      reasons.push("PERSISTENT_FAILURE");
      decision = "avoid";
      confidence = "high";
      riskLevel = "high";
    } else if (freshScore !== null && freshScore < HISTORICAL_SCORE_MIN) {
      // Poor reliability over the whole current score window.
      decision = "avoid";
      confidence = "high";
      riskLevel = "high";
    } else if (!latest.success && failureKind(latest) === "deterministic") {
      // TLS failure, or the endpoint resolves or redirects somewhere private.
      decision = "avoid";
      confidence = latest.checkStatus === "ssrf_blocked" ? "high" : "medium";
      riskLevel = "high";
    } else if (!latest.success && failureStreak >= PERSISTENT_FAILURE_MIN) {
      reasons.push("PERSISTENT_FAILURE");
      limitations.push(`The last ${failureStreak} observations all failed.`);
      decision = "avoid";
      confidence = failureStreak >= LONG_FAILURE_RUN ? "high" : "medium";
      riskLevel = "high";
    } else if (!latest.success) {
      // One failure on its own isn't enough to avoid, or to allow.
      reasons.push(
        failureKind(latest) === "endpoint_error"
          ? "ENDPOINT_ERROR_RESPONSE"
          : "TRANSIENT_NETWORK_FAILURE",
      );
      limitations.push(
        "The most recent observation failed, but a single failure can be temporary; AgentTrust needs another observation to tell a blip from a persistent failure.",
      );
      decision = "insufficient_evidence";
      confidence = "none";
      riskLevel = "elevated";
    } else if (
      historical.status === "down" ||
      historical.status === "degraded"
    ) {
      // Answering again after failures, but not yet for long enough.
      reasons.push("RECOVERING");
      limitations.push(
        "The endpoint answered again after recent failures; it hasn't been observed healthy for long enough to rely on.",
      );
      decision = "insufficient_evidence";
      confidence = "none";
      riskLevel = "elevated";
    } else if (historical.trustDecision.recommended) {
      // Sufficient fresh history: healthy, with a fresh score of at least 50.
      reasons.push("SUFFICIENT_HISTORY");
      decision = "allow_with_caution";
      confidence =
        historical.trustDecision.confidence === "high"
          ? "high"
          : historical.trustDecision.confidence === "medium"
            ? "medium"
            : "low";
      riskLevel =
        confidence === "high"
          ? "low"
          : confidence === "medium"
            ? "moderate"
            : "elevated";
    } else if (
      successfulStreak >= MIN_SUCCESSFUL_OBSERVATIONS &&
      streakSpanMs >= MIN_OBSERVATION_SPAN_MS
    ) {
      reasons.push("INITIAL_OBSERVATIONS_ONLY");
      limitations.push(
        `Based on ${successfulStreak} successful observations over ${Math.round(streakSpanMs / 60000)} minutes; there is no current historical reliability score.`,
      );
      decision = "allow_with_caution";
      confidence = "low";
      riskLevel = "elevated";
    } else {
      // One success (or successes too close together) is never enough.
      reasons.push("FEW_OBSERVATIONS");
      limitations.push(
        `Only ${successfulStreak} successful observation${successfulStreak === 1 ? "" : "s"} so far; at least ${MIN_SUCCESSFUL_OBSERVATIONS}, ${MIN_OBSERVATION_SPAN_MS / 60000}+ minutes apart, are needed without a historical score.`,
      );
      decision = "insufficient_evidence";
      confidence = "none";
      riskLevel = "unknown";
    }
  }

  return {
    assessmentVersion: ASSESSMENT_VERSION,
    mode: "cached",
    status: "complete",
    matched: agent !== null,
    decision,
    confidence,
    reasonCodes: reasons,
    reachability: {
      outcome: latest ? outcomeFor(latest) : "not_checked",
      checkStatus: latest?.checkStatus ?? null,
      httpStatus: latest?.httpStatus ?? null,
      latencyMs: latest?.latencyMs ?? null,
      checkedAt: latest?.checkedAt.toISOString() ?? null,
      ageSeconds,
      fresh,
      source: latest ? "scheduled_check" : null,
    },
    initialRisk: {
      level: riskLevel,
      observations: {
        attempts: observations.length,
        successful: observations.filter((o) => o.success).length,
        successfulStreak,
        streakSpanMinutes: Math.round(streakSpanMs / 60000),
      },
    },
    historical: agent
      ? {
          status: agent.historical.status,
          reliabilityScore: agent.historical.reliabilityScore,
          reliabilityScoreStatus: agent.historical.reliabilityScoreStatus,
          reliabilityScoreComputedAt:
            agent.historical.reliabilityScoreComputedAt?.toISOString() ?? null,
          trustDecision: agent.historical.trustDecision,
        }
      : null,
    agent: agent
      ? {
          slug: agent.slug,
          name: agent.name,
          source: agent.source,
          verified: agent.verified,
          registeredAt: agent.registeredAt.toISOString(),
        }
      : null,
    limitations,
    freshness: {
      assessedAt: now.toISOString(),
      evidenceAgeSeconds: ageSeconds,
      evidenceExpiresAt: latest
        ? new Date(
            latest.checkedAt.getTime() + EVIDENCE_MAX_AGE_HOURS * 3600 * 1000,
          ).toISOString()
        : null,
    },
  };
}
