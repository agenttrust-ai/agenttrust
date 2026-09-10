import "server-only";
import { incrementUsageCounter } from "@/lib/db/queries/usage-counters";
import type { AppDatabase } from "@/lib/db/rls";
import { AppError, ErrorCode } from "@/lib/errors";
import {
  DEFAULT_RATE_LIMIT_PER_WINDOW,
  RATE_LIMIT_WINDOW_SECONDS,
} from "@/lib/rate-limit/config";
import { authenticateApiRequest } from "./authenticate";
import { apiError } from "./response";
import type { VerifiedApiKey } from "@/lib/db/queries/api-keys";

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Unix seconds at which the current window resets. */
  reset: number;
};

/** Fixed windows aligned to the epoch, not to each key's first request — simple and stateless to compute. */
function currentWindowStart(now: Date): Date {
  const epochSeconds = Math.floor(now.getTime() / 1000);
  const bucketStartSeconds =
    epochSeconds - (epochSeconds % RATE_LIMIT_WINDOW_SECONDS);
  return new Date(bucketStartSeconds * 1000);
}

export async function checkRateLimit(
  db: AppDatabase,
  apiKeyId: string,
): Promise<RateLimitResult> {
  const limit = DEFAULT_RATE_LIMIT_PER_WINDOW;
  const windowStart = currentWindowStart(new Date());
  const count = await incrementUsageCounter(db, apiKeyId, windowStart);
  const reset = Math.floor(windowStart.getTime() / 1000) + RATE_LIMIT_WINDOW_SECONDS;

  return {
    allowed: count <= limit,
    limit,
    remaining: Math.max(0, limit - count),
    reset,
  };
}

function withRateLimitHeaders(response: Response, rl: RateLimitResult): Response {
  response.headers.set("X-RateLimit-Limit", String(rl.limit));
  response.headers.set("X-RateLimit-Remaining", String(rl.remaining));
  response.headers.set("X-RateLimit-Reset", String(rl.reset));
  return response;
}

/**
 * The shared entry point for every protected /api/v1/* route: authenticate,
 * charge the key's rate-limit quota, then either reject with 429 or run
 * `handler`. Centralized so no individual endpoint can forget to rate-limit
 * (or accidentally rate-limit before authenticating, which would let a
 * request with an invalid key consume real quota — order here is fixed:
 * auth first, so bad keys are rejected before touching any counter).
 */
export async function withRateLimitedAuth(
  db: AppDatabase,
  request: Request,
  handler: (verified: VerifiedApiKey) => Promise<Response>,
): Promise<Response> {
  try {
    const verified = await authenticateApiRequest(db, request);
    const rl = await checkRateLimit(db, verified.keyId);

    if (!rl.allowed) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const res = apiError(
        new AppError(
          ErrorCode.RATE_LIMITED,
          "Rate limit exceeded. Try again later.",
        ),
      );
      res.headers.set("Retry-After", String(Math.max(0, rl.reset - nowSeconds)));
      return withRateLimitHeaders(res, rl);
    }

    const response = await handler(verified);
    return withRateLimitHeaders(response, rl);
  } catch (error) {
    return apiError(error);
  }
}
