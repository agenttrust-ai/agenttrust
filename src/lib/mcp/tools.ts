import "server-only";
import { z } from "zod";
import type { AppDatabase } from "@/lib/db/rls";
import {
  handleGetAgent,
  handleGetAgentHealth,
  handleHeartbeat,
  handleListAgents,
  toTrustEnrichedAgentJson,
} from "@/lib/api/agents";
import { listPublicAgents } from "@/lib/db/queries/agents";
import { checkAnonymousRateLimit } from "@/lib/api/anonymous-rate-limit";
import { apiError } from "@/lib/api/response";
import { AppError, ErrorCode } from "@/lib/errors";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "@/lib/validation/pagination";

/**
 * The whole MCP adapter's reuse story lives in this one idea: every tool
 * below builds a synthetic `Request` — same shape the real `/api/v1/*`
 * routes receive, carrying the same `Authorization` header — and hands it
 * straight to the exact handler function those routes already call
 * (`handleListAgents`, `handleGetAgent`, ...). Authentication, ownership,
 * rate limiting, visibility, and JSON serialization all happen exactly
 * once, inside that shared handler — nothing here re-implements or
 * bypasses any of it. The base URL is never dereferenced (these handlers
 * only ever read `request.url`'s search params and `request.headers`), so
 * any well-formed absolute URL works.
 */
const SYNTHETIC_BASE_URL = "https://mcp.internal";

function buildSyntheticRequest(
  path: string,
  bearerToken: string | undefined,
  method: "GET" | "POST" = "GET",
): Request {
  const headers = new Headers();
  if (bearerToken) headers.set("authorization", `Bearer ${bearerToken}`);
  return new Request(`${SYNTHETIC_BASE_URL}${path}`, { method, headers });
}

export type McpToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

/**
 * Every REST error already comes back as `{ error: { code, message,
 * details? } }` (src/lib/errors.ts's `AppError.toJSON()`) — reused
 * verbatim here so an MCP client and a REST client see the identical
 * error shape for the identical failure, never a second error taxonomy.
 */
async function toErrorResult(response: Response): Promise<McpToolResult> {
  const body = (await response.json().catch(() => null)) as
    | { error?: { code?: string; message?: string; details?: unknown } }
    | null;
  const error = body?.error ?? {
    code: "INTERNAL_ERROR",
    message: "Something went wrong. Please try again.",
  };

  const enriched: Record<string, unknown> = { ...error };
  if (response.status === 429) {
    const retryAfter = response.headers.get("Retry-After");
    if (retryAfter) enriched.retryAfterSeconds = Number(retryAfter);
  }

  return {
    content: [{ type: "text", text: JSON.stringify(enriched, null, 2) }],
    structuredContent: { error: enriched },
    isError: true,
  };
}

function toSuccessResult(structuredContent: Record<string, unknown>): McpToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}

const agentStatusEnum = z.enum(["unknown", "healthy", "degraded", "down"]);

const agentCardOutputSchema = z.object({
  schemaVersion: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  capabilities: z.array(z.string()),
  authentication: z.object({ type: z.string() }),
  interfaces: z.object({
    modalities: z.array(z.string()),
    interactionType: z.string().nullable(),
  }),
  documentationUrl: z.string().nullable(),
});

/**
 * Derived from the agent's own status/reliability-score/verification —
 * never a second score. See src/lib/reliability/trust-decision.ts.
 */
const trustDecisionOutputSchema = z.object({
  recommended: z.boolean(),
  confidence: z.enum(["high", "medium", "low", "insufficient_data"]),
  reasons: z.array(z.string()),
});

const publicAgentOutputSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  version: z.string().nullable(),
  capabilities: z.array(z.string()),
  status: agentStatusEnum,
  createdAt: z.string(),
  agentCard: agentCardOutputSchema,
  verified: z.boolean(),
  ownershipVerifiedAt: z.string().nullable(),
  // Present only when this result came from an `endpointUrl` lookup (a
  // trust check), not from browsing the plain unfiltered listing — see
  // `mcpListAgents` / `handleListAgents`.
  reliabilityScore: z.number().nullable().optional(),
  reliabilityScoreComputedAt: z.string().nullable().optional(),
  lastCheckedAt: z.string().nullable().optional(),
  latencyMs: z.number().nullable().optional(),
  httpStatus: z.number().nullable().optional(),
  trustDecision: trustDecisionOutputSchema.optional(),
});

export const listAgentsInputSchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_LIMIT)
    .optional()
    .describe(`Max agents to return (1-${MAX_PAGE_LIMIT}, default ${DEFAULT_PAGE_LIMIT}).`),
  cursor: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .optional()
    .describe("Opaque pagination cursor from a previous call's nextCursor."),
  endpointUrl: z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .optional()
    .describe(
      "Look up the agent registered with exactly this invocation URL, instead of browsing the full listing — the entry point for a trust check on an agent you only have a URL for. Matches ignore trailing-slash and scheme/host-casing differences only — never a fuzzy match. Returns an empty list, not an error, if nothing is registered with that URL. Unlike a plain (unfiltered) call, results here also include reliabilityScore, lastCheckedAt/latencyMs/httpStatus, and a derived trustDecision ({recommended, confidence, reasons}) so a caller can decide whether to interact with the agent from this one call.",
    ),
});
export type ListAgentsInput = z.infer<typeof listAgentsInputSchema>;

export const listAgentsOutputSchema = z.object({
  agents: z.array(publicAgentOutputSchema),
  pagination: z.object({ nextCursor: z.string().nullable() }),
});

export async function mcpListAgents(
  db: AppDatabase,
  bearerToken: string | undefined,
  input: ListAgentsInput,
): Promise<McpToolResult> {
  const path = new URL(`${SYNTHETIC_BASE_URL}/api/v1/agents`);
  if (input.limit !== undefined) path.searchParams.set("limit", String(input.limit));
  if (input.cursor) path.searchParams.set("cursor", input.cursor);
  if (input.endpointUrl) path.searchParams.set("endpoint_url", input.endpointUrl);

  const request = buildSyntheticRequest(
    path.pathname + path.search,
    bearerToken,
  );
  const response = await handleListAgents(db, request);
  if (!response.ok) return toErrorResult(response);

  const body = (await response.json()) as {
    data: unknown[];
    pagination: { nextCursor: string | null };
  };
  return toSuccessResult({ agents: body.data, pagination: body.pagination });
}

const agentSlugField = z
  .string()
  .trim()
  .min(1, { error: "slug is required." })
  .max(200, { error: "slug must be 200 characters or fewer." })
  .describe("The agent's URL slug (from its public profile or a list_agents result).");

export const getAgentInputSchema = z.object({ slug: agentSlugField });
export type GetAgentInput = z.infer<typeof getAgentInputSchema>;

export const getAgentOutputSchema = publicAgentOutputSchema.extend({
  reliabilityScore: z.number().nullable(),
  reliabilityScoreComputedAt: z.string().nullable(),
  lastCheckedAt: z.string().nullable(),
  latencyMs: z.number().nullable(),
  httpStatus: z.number().nullable(),
  trustDecision: trustDecisionOutputSchema,
});

export async function mcpGetAgent(
  db: AppDatabase,
  bearerToken: string | undefined,
  input: GetAgentInput,
): Promise<McpToolResult> {
  const request = buildSyntheticRequest(
    `/api/v1/agents/${encodeURIComponent(input.slug)}`,
    bearerToken,
  );
  const response = await handleGetAgent(db, request, input.slug);
  if (!response.ok) return toErrorResult(response);

  const body = (await response.json()) as { data: Record<string, unknown> };
  return toSuccessResult(body.data);
}

export const getAgentHealthInputSchema = z.object({ slug: agentSlugField });
export type GetAgentHealthInput = z.infer<typeof getAgentHealthInputSchema>;

export const getAgentHealthOutputSchema = z.object({
  agentId: z.string(),
  slug: z.string(),
  status: agentStatusEnum,
  lastCheckedAt: z.string().nullable(),
  latencyMs: z.number().nullable(),
  httpStatus: z.number().nullable(),
  checkStatus: z.string().nullable(),
  reliabilityScore: z.number().nullable(),
  reliabilityScoreComputedAt: z.string().nullable(),
});

export async function mcpGetAgentHealth(
  db: AppDatabase,
  bearerToken: string | undefined,
  input: GetAgentHealthInput,
): Promise<McpToolResult> {
  const request = buildSyntheticRequest(
    `/api/v1/agents/${encodeURIComponent(input.slug)}/health`,
    bearerToken,
  );
  const response = await handleGetAgentHealth(db, request, input.slug);
  if (!response.ok) return toErrorResult(response);

  const body = (await response.json()) as { data: Record<string, unknown> };
  return toSuccessResult(body.data);
}

export const sendHeartbeatInputSchema = z.object({ slug: agentSlugField });
export type SendHeartbeatInput = z.infer<typeof sendHeartbeatInputSchema>;

export const sendHeartbeatOutputSchema = z.object({
  slug: z.string(),
  status: agentStatusEnum,
  lastHeartbeatAt: z.string().nullable(),
});

/**
 * No timestamp field anywhere in `sendHeartbeatInputSchema` on purpose —
 * mirrors `POST /api/v1/agents/{slug}/heartbeat` exactly, which never reads
 * a request body at all. `handleHeartbeat` stamps `lastHeartbeatAt` with
 * its own `new Date()`; nothing an MCP client sends can influence it.
 */
export async function mcpSendHeartbeat(
  db: AppDatabase,
  bearerToken: string | undefined,
  input: SendHeartbeatInput,
): Promise<McpToolResult> {
  const request = buildSyntheticRequest(
    `/api/v1/agents/${encodeURIComponent(input.slug)}/heartbeat`,
    bearerToken,
    "POST",
  );
  const response = await handleHeartbeat(db, request, input.slug);
  if (!response.ok) return toErrorResult(response);

  const body = (await response.json()) as { data: Record<string, unknown> };
  return toSuccessResult(body.data);
}

/**
 * `check_agent_trust` — the one anonymous tool. No Bearer token required,
 * no listing/search/pagination/cursor: it accepts exactly one required
 * field and returns exactly one of two shapes (matched or not). Every
 * other MCP tool in this file stays owner/API-key-gated exactly as before;
 * this is deliberately the only exception, and deliberately narrower than
 * `list_agents({endpointUrl})` in both input and output.
 */
export const checkAgentTrustInputSchema = z.object({
  endpointUrl: z
    .string()
    .trim()
    .min(1, { error: "endpointUrl is required." })
    .max(2048, { error: "endpointUrl must be 2048 characters or fewer." }),
});
export type CheckAgentTrustInput = z.infer<typeof checkAgentTrustInputSchema>;

export const checkAgentTrustOutputSchema = z.object({
  matched: z.boolean(),
  slug: z.string().optional(),
  name: z.string().optional(),
  status: agentStatusEnum.optional(),
  verified: z.boolean().optional(),
  reliabilityScore: z.number().nullable().optional(),
  trustDecision: trustDecisionOutputSchema.optional(),
});

/**
 * `request` here is the *real* inbound HTTP request (from `ctx.http.req` in
 * `src/lib/mcp/server.ts`), not a synthetic one — this tool needs the
 * caller's actual IP for rate-limiting, which none of the other tools
 * (owner/API-key-gated, and rate-limited by that key instead) ever needed.
 *
 * Deliberately does NOT go through `handleListAgents`/`withRateLimitedAuth`
 * — that wrapper requires a valid API key to rate-limit at all, which is
 * exactly the requirement this tool exists to not have. It reuses
 * `listPublicAgents` and `toTrustEnrichedAgentJson` directly instead —
 * the identical query/normalization/trustDecision logic, just called
 * without the auth step, so there is only ever one implementation of
 * "how an endpoint URL is matched to a public agent" in this codebase.
 */
export async function mcpCheckAgentTrust(
  db: AppDatabase,
  request: Request,
  input: CheckAgentTrustInput,
): Promise<McpToolResult> {
  const rateLimit = await checkAnonymousRateLimit(db, request);
  if (!rateLimit.allowed) {
    const response = apiError(
      new AppError(
        ErrorCode.RATE_LIMITED,
        `Checking too often — try again in ${rateLimit.retryAfterSeconds}s.`,
        { retryAfterSeconds: rateLimit.retryAfterSeconds },
      ),
    );
    // toErrorResult (below) reads retryAfterSeconds off a Retry-After
    // header, exactly like the REST 429 path (withRateLimitedAuth) —
    // apiError alone doesn't set one, so it's added here explicitly.
    response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
    return toErrorResult(response);
  }

  // Never queries anything but the already-stored public+active directory —
  // no outbound request to endpointUrl happens anywhere in this call.
  const page = await listPublicAgents(db, { limit: 1, endpointUrl: input.endpointUrl });
  const agent = page.agents[0];
  if (!agent) {
    return toSuccessResult({ matched: false });
  }

  const enriched = await toTrustEnrichedAgentJson(db, agent);
  return toSuccessResult({
    matched: true,
    slug: enriched.slug,
    name: enriched.name,
    status: enriched.status,
    verified: enriched.verified,
    reliabilityScore: enriched.reliabilityScore,
    trustDecision: enriched.trustDecision,
  });
}
