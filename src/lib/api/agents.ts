import "server-only";
import { z } from "zod";
import type { AppDatabase } from "@/lib/db/rls";
import {
  getPublicAgentBySlug,
  listPublicAgents,
  recordAgentHeartbeatBySlug,
  type Agent,
} from "@/lib/db/queries/agents";
import { getLatestCheckPublic, recordHealthCheck } from "@/lib/db/queries/health-checks";
import {
  computeAndStoreReliabilityScore,
  getLatestReliabilityScorePublic,
} from "@/lib/db/queries/reliability";
import { getEffectiveAgentStatus } from "@/lib/monitoring/heartbeat-status";
import { computeTrustDecision } from "@/lib/reliability/trust-decision";
import { buildAgentCard } from "@/lib/validation/agent-card";
import { withRateLimitedAuth } from "./rate-limit";
import { apiSuccess } from "./response";
import { parsePaginationQuery } from "@/lib/validation/pagination";
import { AppError, ErrorCode } from "@/lib/errors";

/**
 * The Public API's view of an agent — deliberately narrower than the DB
 * row: no `ownerId`, no internal monitoring config. Mirrors exactly what
 * the public profile page (src/app/a/[slug]/page.tsx) already shows, so
 * the API and the UI never disagree about what "public" means for an agent.
 */
function toPublicAgentJson(agent: Agent) {
  return {
    id: agent.id,
    slug: agent.slug,
    name: agent.name,
    description: agent.description,
    version: agent.version,
    capabilities: agent.capabilityTags,
    status: getEffectiveAgentStatus(agent),
    createdAt: agent.createdAt,
    // Built purely from fields already on `agent` — no extra query, so
    // this is free on both the list and detail endpoints alike.
    agentCard: buildAgentCard(agent),
    // The endpoint-ownership verification *result* — never the challenge
    // token itself (agent.ownershipVerificationToken is deliberately never
    // referenced here; see src/lib/verification/ownership.ts).
    verified: agent.ownershipVerifiedAt !== null,
    ownershipVerifiedAt: agent.ownershipVerifiedAt,
  };
}

/**
 * `toPublicAgentJson` plus the trust-relevant signals a caller needs to
 * actually decide whether to interact with this agent: the existing
 * reliability score, the existing latest health check, and a `trustDecision`
 * *derived* from those two plus `verified` — never a new/second score (see
 * `computeTrustDecision`). Two extra reads per agent, so this is only used
 * where the result set is inherently small — a single agent, or an
 * `endpoint_url` lookup — never the unfiltered listing (see
 * `handleListAgents`), which would turn this into an N+1 query per page.
 */
async function toTrustEnrichedAgentJson(db: AppDatabase, agent: Agent) {
  const [latestScore, latestCheck] = await Promise.all([
    getLatestReliabilityScorePublic(db, agent.id),
    getLatestCheckPublic(db, agent.id),
  ]);
  const score = latestScore?.score ?? null;
  const status = getEffectiveAgentStatus(agent);
  const verified = agent.ownershipVerifiedAt !== null;

  return {
    ...toPublicAgentJson(agent),
    reliabilityScore: score,
    reliabilityScoreComputedAt: latestScore?.computedAt ?? null,
    lastCheckedAt: latestCheck?.checkedAt ?? null,
    latencyMs: latestCheck?.latencyMs ?? null,
    httpStatus: latestCheck?.statusCode ?? null,
    trustDecision: computeTrustDecision({ status, score, verified }),
  };
}

/** GET /api/v1/agents */
export async function handleListAgents(
  db: AppDatabase,
  request: Request,
): Promise<Response> {
  return withRateLimitedAuth(db, request, async () => {
    const url = new URL(request.url);
    const parsed = parsePaginationQuery(url.searchParams);
    if (!parsed.success) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        "Invalid pagination parameters.",
        z.flattenError(parsed.error).fieldErrors,
      );
    }

    // Discovery by endpoint URL — for a caller that only has some agent's
    // invocation URL, not its AgentTrust slug. Read directly rather than
    // through `parsePaginationQuery` so that schema stays untouched and
    // every existing caller of this route keeps behaving identically.
    const endpointUrl = url.searchParams.get("endpoint_url")?.trim() || null;

    const page = await listPublicAgents(db, {
      limit: parsed.data.limit,
      cursor: parsed.data.cursor ?? null,
      endpointUrl,
    });

    // Trust-signal enrichment (score/health/decision) is deliberately only
    // added on the `endpoint_url` lookup path — a caller browsing the full,
    // unfiltered listing gets exactly the same response shape as before,
    // unchanged, and never pays for the extra per-agent queries that
    // enrichment costs.
    const data = endpointUrl
      ? await Promise.all(page.agents.map((agent) => toTrustEnrichedAgentJson(db, agent)))
      : page.agents.map(toPublicAgentJson);

    return apiSuccess(data, {
      pagination: { nextCursor: page.nextCursor },
    });
  });
}

/** GET /api/v1/agents/{slug} */
export async function handleGetAgent(
  db: AppDatabase,
  request: Request,
  slug: string,
): Promise<Response> {
  return withRateLimitedAuth(db, request, async () => {
    const agent = await getPublicAgentBySlug(db, slug);
    return apiSuccess(await toTrustEnrichedAgentJson(db, agent));
  });
}

/** GET /api/v1/agents/{slug}/health */
export async function handleGetAgentHealth(
  db: AppDatabase,
  request: Request,
  slug: string,
): Promise<Response> {
  return withRateLimitedAuth(db, request, async () => {
    // Reuses the same public+active gate as handleGetAgent — a draft or
    // unlisted agent's health must be exactly as invisible as its profile.
    const agent = await getPublicAgentBySlug(db, slug);
    const latest = await getLatestCheckPublic(db, agent.id);
    const latestScore = await getLatestReliabilityScorePublic(db, agent.id);

    return apiSuccess({
      agentId: agent.id,
      slug: agent.slug,
      status: getEffectiveAgentStatus(agent),
      lastCheckedAt: latest?.checkedAt ?? null,
      latencyMs: latest?.latencyMs ?? null,
      httpStatus: latest?.statusCode ?? null,
      checkStatus: latest?.status ?? null,
      reliabilityScore: latestScore?.score ?? null,
      reliabilityScoreComputedAt: latestScore?.computedAt ?? null,
    });
  });
}

/**
 * POST /api/v1/agents/{slug}/heartbeat
 *
 * Deliberately minimal: the only thing this endpoint does is prove "this
 * agent is alive, right now" — no client-supplied fields are read or
 * trusted, including any timestamp, so there's nothing here for a caller to
 * spoof beyond holding a valid key for the right account. `verified.ownerId`
 * (from the API key, not from anything in the request body) is what
 * `recordAgentHeartbeatBySlug` checks against the agent's owner — a key
 * belonging to a different account gets the same NOT_FOUND a nonexistent
 * slug would, never a hint that the agent exists under someone else.
 */
export async function handleHeartbeat(
  db: AppDatabase,
  request: Request,
  slug: string,
): Promise<Response> {
  return withRateLimitedAuth(db, request, async (verified) => {
    const now = new Date();
    const agent = await recordAgentHeartbeatBySlug(db, verified.ownerId, slug, now);

    // Lands in the same table pull checks do, so "last checked" summaries
    // on the dashboard and public profile reflect the heartbeat for free.
    await recordHealthCheck(
      db,
      agent.id,
      {
        status: "success",
        success: true,
        latencyMs: null,
        httpStatus: null,
        errorCode: null,
        errorMessage: null,
      },
      "push",
      now,
    );

    // Best-effort, same as the pull cron's equivalent call — a scoring
    // failure must never fail the heartbeat itself.
    try {
      await computeAndStoreReliabilityScore(db, agent.id, now);
    } catch (error) {
      console.error("Reliability score computation failed:", error);
    }

    return apiSuccess({
      slug: agent.slug,
      status: getEffectiveAgentStatus(agent, now),
      lastHeartbeatAt: agent.lastHeartbeatAt,
    });
  });
}
