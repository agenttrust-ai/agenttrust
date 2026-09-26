import type { AgentHealthStatus } from "@/lib/monitoring/status";
import type { ReliabilityScoreStatus } from "@/lib/reliability/freshness";
import { computeTrustDecision } from "@/lib/reliability/trust-decision";

/** The fictional endpoint used by every illustrative example. */
export const EXAMPLE_ENDPOINT = "https://agent.example.com/a2a";

/**
 * An illustrative result in exactly the shape `check_agent_trust` returns.
 * The `trustDecision` is never hand-written: it comes from the same
 * `computeTrustDecision` the live check uses, so examples can't drift from
 * the real rules. Names and endpoints must be fictional.
 */
export function exampleResult(input: {
  name: string;
  slug: string;
  status: AgentHealthStatus;
  score: number | null;
  scoreStatus: ReliabilityScoreStatus;
  verified: boolean;
}) {
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

/** The canonical "healthy, current, verified" example. */
export const PRIMARY_EXAMPLE = exampleResult({
  name: "Example Agent",
  slug: "example-agent",
  status: "healthy",
  score: 96,
  scoreStatus: "fresh",
  verified: true,
});
