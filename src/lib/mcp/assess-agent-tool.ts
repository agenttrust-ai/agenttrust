import "server-only";
import { z } from "zod";
import type { AppDatabase } from "@/lib/db/rls";
import { checkAnonymousRateLimit } from "@/lib/api/anonymous-rate-limit";
import { apiError } from "@/lib/api/response";
import { AppError, ErrorCode } from "@/lib/errors";
import {
  ASSESSMENT_CONFIDENCES,
  ASSESSMENT_DECISIONS,
  INITIAL_RISK_LEVELS,
  REACHABILITY_OUTCOMES,
  REASON_CODES,
} from "@/lib/assessment/assess";
import {
  getAgentAssessment,
  logAssessment,
} from "@/lib/assessment/get-assessment";
import {
  agentStatusEnum,
  reliabilityScoreStatusEnum,
  toErrorResult,
  toSuccessResult,
  trustDecisionOutputSchema,
  type McpToolResult,
} from "./tools";

/**
 * `assess_agent` — an immediate, machine-readable use-or-avoid decision
 * about another agent's endpoint, for an AI agent about to call it. Like
 * `check_agent_trust`, it needs no API key, only reads AgentTrust's stored
 * data, and never contacts endpointUrl; unlike it, it returns a decision
 * (allow_with_caution / avoid / insufficient_evidence) with reason codes,
 * evidence, limitations and freshness. The historical trustDecision is
 * included unchanged.
 */
export const assessAgentInputSchema = z.object({
  endpointUrl: z
    .string()
    .trim()
    .min(1, { error: "endpointUrl is required." })
    .max(2048, { error: "endpointUrl must be 2048 characters or fewer." })
    .describe(
      "The exact invocation URL of the agent you're about to call. Used only to look up AgentTrust's stored observations of it — this endpoint is never contacted.",
    ),
});
export type AssessAgentInput = z.infer<typeof assessAgentInputSchema>;

const CHECK_STATUSES = [
  "success",
  "http_error",
  "timeout",
  "dns_error",
  "tls_error",
  "connection_error",
  "ssrf_blocked",
  "unknown_error",
] as const;

export const assessAgentOutputSchema = z.object({
  assessmentVersion: z.literal("1"),
  mode: z.literal("cached"),
  status: z.literal("complete"),
  matched: z.boolean(),
  decision: z.enum(ASSESSMENT_DECISIONS),
  confidence: z.enum(ASSESSMENT_CONFIDENCES),
  reasonCodes: z.array(z.enum(REASON_CODES)),
  reachability: z.object({
    outcome: z.enum(REACHABILITY_OUTCOMES),
    checkStatus: z.enum(CHECK_STATUSES).nullable(),
    httpStatus: z.number().nullable(),
    latencyMs: z.number().nullable(),
    checkedAt: z.string().nullable(),
    ageSeconds: z.number().nullable(),
    fresh: z.boolean(),
    source: z.literal("scheduled_check").nullable(),
  }),
  initialRisk: z.object({
    level: z.enum(INITIAL_RISK_LEVELS),
    observations: z.object({
      attempts: z.number(),
      successful: z.number(),
      successfulStreak: z.number(),
      streakSpanMinutes: z.number(),
    }),
  }),
  historical: z
    .object({
      status: agentStatusEnum,
      reliabilityScore: z.number().nullable(),
      reliabilityScoreStatus: reliabilityScoreStatusEnum,
      reliabilityScoreComputedAt: z.string().nullable(),
      trustDecision: trustDecisionOutputSchema,
    })
    .nullable(),
  agent: z
    .object({
      slug: z.string(),
      name: z.string(),
      source: z.enum(["owner_registered", "externally_observed"]),
      verified: z.boolean(),
      registeredAt: z.string(),
    })
    .nullable(),
  limitations: z.array(z.string()),
  freshness: z.object({
    assessedAt: z.string(),
    evidenceAgeSeconds: z.number().nullable(),
    evidenceExpiresAt: z.string().nullable(),
  }),
});

/**
 * Rate-limited exactly like `check_agent_trust` (per caller IP, same
 * buckets), since it is the same anonymous read path with the same cost.
 * Writes nothing but that rate-limit bookkeeping: no telemetry row, no
 * observation request, no outbound request.
 */
export async function mcpAssessAgent(
  db: AppDatabase,
  request: Request,
  input: AssessAgentInput,
  surface: "mcp" | "mcp_public",
): Promise<McpToolResult> {
  const started = performance.now();
  const rateLimit = await checkAnonymousRateLimit(db, request);
  if (!rateLimit.allowed) {
    const response = apiError(
      new AppError(
        ErrorCode.RATE_LIMITED,
        `Checking too often — try again in ${rateLimit.retryAfterSeconds}s.`,
        { retryAfterSeconds: rateLimit.retryAfterSeconds },
      ),
    );
    response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
    return toErrorResult(response);
  }

  const assessment = await getAgentAssessment(db, input.endpointUrl);
  logAssessment(surface, assessment, performance.now() - started);
  return toSuccessResult(assessment as unknown as Record<string, unknown>);
}
