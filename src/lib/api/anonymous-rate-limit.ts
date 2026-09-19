import "server-only";
import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { anonymousRateLimits } from "@/lib/db/schema";
import { withDbErrorNormalization, type AppDatabase } from "@/lib/db/rls";

export const ANONYMOUS_RATE_LIMIT_WINDOW_SECONDS = 60;
export const ANONYMOUS_RATE_LIMIT_PER_IP = 10;
export const ANONYMOUS_RATE_LIMIT_GLOBAL = 300;

/**
 * Reuses the same table as the per-IP buckets for the aggregate safety cap
 * across every anonymous caller combined, instead of adding a second table.
 * Never collides with a real IP hash: SHA-256 hex digests are always
 * exactly 64 lowercase hex characters, never this literal string.
 */
const GLOBAL_RATE_LIMIT_KEY = "GLOBAL";

function currentWindowStart(now: Date): Date {
  const epochSeconds = Math.floor(now.getTime() / 1000);
  const bucketStartSeconds =
    epochSeconds - (epochSeconds % ANONYMOUS_RATE_LIMIT_WINDOW_SECONDS);
  return new Date(bucketStartSeconds * 1000);
}

/**
 * Hashes the caller's IP before it ever touches storage -- the raw address
 * is never persisted or logged. Not a security-critical secret (an IP
 * isn't confidential the way a password is), so a plain unsalted SHA-256
 * is sufficient: the goal is "don't store raw IPs verbatim", not "prevent
 * an operator with DB access from ever correlating repeat callers".
 */
function hashIp(ip: string): string {
  return crypto.createHash("sha256").update(ip).digest("hex");
}

/**
 * The caller's IP, per Vercel's own documented header behavior (confirmed
 * against vercel.com/docs/headers/request-headers): "we currently overwrite
 * the X-Forwarded-For header and do not forward external IPs" -- on this
 * project's plan (no purchased Trusted Proxy override), Vercel fully
 * replaces x-forwarded-for with the real observed client IP and discards
 * anything the client sent, so it is NOT spoofable here. x-vercel-forwarded-for
 * is tried first since Vercel documents it as staying correct even if a
 * proxy is ever added in front of Vercel later; x-forwarded-for and
 * x-real-ip are Vercel-documented equivalents, kept only as a fallback.
 *
 * Returns null -- never a guess -- if none of these headers are present.
 * Callers MUST treat null as "fail closed", never as "unlimited".
 */
export function extractTrustedClientIp(request: Request): string | null {
  const headerNames = ["x-vercel-forwarded-for", "x-forwarded-for", "x-real-ip"];
  for (const name of headerNames) {
    const value = request.headers.get(name);
    if (!value) continue;
    const first = value.split(",")[0]?.trim();
    if (first) return first;
  }
  return null;
}

export type AnonymousRateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

/**
 * One atomic claim against one bucket (a specific IP hash, or the GLOBAL
 * sentinel) for the current fixed window. `INSERT ... ON CONFLICT ... DO
 * UPDATE ... RETURNING` is a single round-trip, race-safe increment --
 * the same atomic-claim principle already used by
 * `checkOwnershipVerification`'s cooldown elsewhere in this codebase --
 * so two concurrent requests from the same bucket can never both read a
 * stale count and both succeed past the limit.
 */
async function claimWindow(
  db: AppDatabase,
  key: string,
  windowStart: Date,
  limit: number,
): Promise<AnonymousRateLimitResult> {
  const [row] = await db
    .insert(anonymousRateLimits)
    .values({ ipHash: key, windowStart, requestCount: 1 })
    .onConflictDoUpdate({
      target: [anonymousRateLimits.ipHash, anonymousRateLimits.windowStart],
      set: { requestCount: sql`${anonymousRateLimits.requestCount} + 1` },
    })
    .returning({ requestCount: anonymousRateLimits.requestCount });

  if (!row || row.requestCount > limit) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const windowEndSeconds =
      Math.floor(windowStart.getTime() / 1000) + ANONYMOUS_RATE_LIMIT_WINDOW_SECONDS;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, windowEndSeconds - nowSeconds),
    };
  }
  return { allowed: true };
}

/**
 * The full anonymous rate-limit check for one request: per-IP first, then
 * the aggregate global cap. Both are independently atomic; running them as
 * two separate claims (rather than one transaction) is intentional -- each
 * is already a correct, race-safe counter for its own purpose, and a
 * request that trips the per-IP limit never needs to touch the global
 * counter at all. A request that passes the per-IP check but then trips
 * the global cap has still consumed one of its own per-IP slots -- a minor,
 * deliberately-accepted over-attribution (never an under-count), not a
 * bypass of anything.
 *
 * Fails closed in every unclear case: no trustworthy IP signal at all, or
 * any error while checking state -- both return `allowed: false` rather
 * than risk silently becoming "no limit". This mechanism *is* the security
 * control for this anonymous surface, so unlike best-effort derived data
 * elsewhere in this codebase (e.g. reliability scoring), a failure here
 * must never fail open.
 */
export async function checkAnonymousRateLimit(
  db: AppDatabase,
  request: Request,
): Promise<AnonymousRateLimitResult> {
  const ip = extractTrustedClientIp(request);
  if (!ip) {
    return { allowed: false, retryAfterSeconds: ANONYMOUS_RATE_LIMIT_WINDOW_SECONDS };
  }

  try {
    const now = new Date();
    const windowStart = currentWindowStart(now);
    const ipHash = hashIp(ip);

    return await withDbErrorNormalization(async () => {
      const perIp = await claimWindow(
        db,
        ipHash,
        windowStart,
        ANONYMOUS_RATE_LIMIT_PER_IP,
      );
      if (!perIp.allowed) return perIp;

      return claimWindow(
        db,
        GLOBAL_RATE_LIMIT_KEY,
        windowStart,
        ANONYMOUS_RATE_LIMIT_GLOBAL,
      );
    });
  } catch (error) {
    console.error("Anonymous rate limit check failed:", error);
    return { allowed: false, retryAfterSeconds: ANONYMOUS_RATE_LIMIT_WINDOW_SECONDS };
  }
}
