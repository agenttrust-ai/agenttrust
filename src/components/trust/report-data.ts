import type { AgentHealthStatus } from "@/lib/monitoring/status";
import type { ReliabilityScoreStatus } from "@/lib/reliability/freshness";
import { computeTrustDecision } from "@/lib/reliability/trust-decision";

export type TrustEvidence = {
  name: string;
  slug: string;
  /** `getEffectiveAgentStatus(agent)`. */
  status: AgentHealthStatus;
  /** The latest stored score, even when stale — exactly what the API returns. */
  score: number | null;
  scoreStatus: ReliabilityScoreStatus;
  /** `agent.ownershipVerifiedAt !== null`. */
  verified: boolean;
};

/**
 * Builds a result in exactly the shape `check_agent_trust` returns for a
 * matched agent, from the same four inputs `toTrustEnrichedAgentJson`
 * (src/lib/api/agents.ts) feeds `computeTrustDecision`. Nothing is
 * decided here: the trustDecision comes from the one shared function, so
 * a page showing an agent's report can't disagree with what a caller of
 * the API or MCP tool gets for that agent.
 */
export function trustReportFromEvidence(input: TrustEvidence) {
  return {
    matched: true as const,
    slug: input.slug,
    name: input.name,
    status: input.status,
    verified: input.verified,
    reliabilityScore: input.score,
    reliabilityScoreStatus: input.scoreStatus,
    trustDecision: computeTrustDecision({
      status: input.status,
      score: input.score,
      verified: input.verified,
      scoreStatus: input.scoreStatus,
    }),
  };
}
