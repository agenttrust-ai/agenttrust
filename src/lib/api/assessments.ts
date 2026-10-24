import "server-only";
import type { AppDatabase } from "@/lib/db/rls";
import {
  getAgentAssessment,
  logAssessment,
} from "@/lib/assessment/get-assessment";
import { AppError, ErrorCode } from "@/lib/errors";
import { withRateLimitedAuth } from "./rate-limit";
import { apiSuccess } from "./response";

const MAX_ENDPOINT_URL_LENGTH = 2048;

/**
 * GET /api/v1/assessments?endpoint_url=<url>
 *
 * The same agent assessment as the `assess_agent` MCP tool, for REST
 * callers: authenticated and rate-limited per API key like every other
 * /api/v1 endpoint. Read-only — built from AgentTrust's stored data, it
 * never contacts endpoint_url.
 */
export async function handleGetAssessment(
  db: AppDatabase,
  request: Request,
): Promise<Response> {
  return withRateLimitedAuth(db, request, async () => {
    const endpointUrl =
      new URL(request.url).searchParams.get("endpoint_url")?.trim() ?? "";
    if (endpointUrl === "") {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        "endpoint_url is required.",
        {
          endpoint_url: ["endpoint_url is required."],
        },
      );
    }
    if (endpointUrl.length > MAX_ENDPOINT_URL_LENGTH) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        "endpoint_url is too long.",
        {
          endpoint_url: [
            `endpoint_url must be ${MAX_ENDPOINT_URL_LENGTH} characters or fewer.`,
          ],
        },
      );
    }

    const started = performance.now();
    const assessment = await getAgentAssessment(db, endpointUrl);
    logAssessment("rest", assessment, performance.now() - started);
    return apiSuccess(assessment);
  });
}
