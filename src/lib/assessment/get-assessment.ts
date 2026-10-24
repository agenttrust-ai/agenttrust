import "server-only";
import type { AppDatabase } from "@/lib/db/rls";
import { listPublicAgents } from "@/lib/db/queries/agents";
import { getRecentChecksPublic } from "@/lib/db/queries/health-checks";
import { toTrustEnrichedAgentJson } from "@/lib/api/agents";
import { SCORE_WINDOW_DAYS } from "@/lib/reliability/scoring";
import { assessAgent, type AgentAssessment } from "./assess";

/** At most this many stored observations are read per assessment — enough for a 7-day window of daily checks with room to spare. */
export const ASSESSMENT_OBSERVATION_LIMIT = 20;

/**
 * Builds an agent assessment for `endpointUrl` from AgentTrust's stored
 * data only. The same read path as `check_agent_trust` — the public, active
 * directory, matched exactly after URL normalization — plus the agent's
 * recent stored checks. Never contacts `endpointUrl`, and writes nothing.
 *
 * `historical` is built by `toTrustEnrichedAgentJson`, the function behind
 * every other trustDecision in the API, so it can't diverge from them.
 */
export async function getAgentAssessment(
  db: AppDatabase,
  endpointUrl: string,
  now: Date = new Date(),
): Promise<AgentAssessment> {
  const page = await listPublicAgents(db, { limit: 1, endpointUrl });
  const agent = page.agents[0];
  if (!agent) return assessAgent({ now, agent: null, observations: [] });

  const since = new Date(
    now.getTime() - SCORE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
  const [enriched, checks] = await Promise.all([
    toTrustEnrichedAgentJson(db, agent),
    getRecentChecksPublic(db, agent.id, since, ASSESSMENT_OBSERVATION_LIMIT),
  ]);

  return assessAgent({
    now,
    agent: {
      slug: enriched.slug,
      name: enriched.name,
      source: enriched.source,
      verified: enriched.verified,
      registeredAt: agent.createdAt,
      historical: {
        status: enriched.status,
        reliabilityScore: enriched.reliabilityScore,
        reliabilityScoreStatus: enriched.reliabilityScoreStatus,
        reliabilityScoreComputedAt: enriched.reliabilityScoreComputedAt,
        trustDecision: enriched.trustDecision,
      },
    },
    observations: checks.map((check) => ({
      checkedAt: check.checkedAt,
      success: check.success,
      checkStatus: check.status,
      httpStatus: check.statusCode,
      latencyMs: check.latencyMs,
    })),
  });
}

/**
 * One structured log line per assessment, for auditing decisions without
 * storing anything: which surface asked, what was decided and why, and for
 * which agent. Never the requested URL or the caller's IP.
 */
export function logAssessment(
  surface: "mcp" | "mcp_public" | "rest",
  assessment: AgentAssessment,
  durationMs: number,
): void {
  console.info(
    JSON.stringify({
      event: "agent_assessment",
      surface,
      matched: assessment.matched,
      agentSlug: assessment.agent?.slug ?? null,
      decision: assessment.decision,
      confidence: assessment.confidence,
      reasonCodes: assessment.reasonCodes,
      durationMs: Math.round(durationMs),
    }),
  );
}
