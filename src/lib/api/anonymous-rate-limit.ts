import "server-only";
import crypto from "node:crypto";
import { and, eq, lt, ne, sql } from "drizzle-orm";
import { env } from "@/lib/config.server";
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
 * Per-IP buckets older than this are deleted; a bucket is only ever read
 * during its own 60-second window.
 */
export const PER_IP_RETENTION_MS = 24 * 60 * 60 * 1000;
/** GLOBAL buckets (aggregate counts, no personal data) are kept this long. */
export const GLOBAL_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const CLEANUP_PROBABILITY = 0.01;
const CLEANUP_BATCH = 1_000;

/** HKDF `info` prefix for the rate-limit IP subkey; the UTC day is appended. */
export const RATE_LIMIT_IP_KEY_INFO_PREFIX = "agenttrust/anonymous-rate-limit/ip/v1/day=";

/**
 * The bucket key for a caller's IP: HMAC-SHA256 of the IP under a subkey
 * derived (HKDF-SHA256) from API_KEY_HASH_PEPPER with a label that names
 * this purpose and the window's UTC day. The raw address is never stored
 * or logged, and — unlike a plain hash — the key can't be reversed by
 * hashing the whole IPv4 space without the secret, or linked across days.
 *
 * Correctness only needs the same key for the same IP within one 60-second
 * window. The day comes from the window's own start, and UTC midnight is
 * always a window boundary (86,400 is a multiple of 60), so a window never
 * spans two keys. The pepper is required at startup, so this security
 * control never runs without a key. The label keeps it separate from API-key
 * hashing (HMAC directly under the pepper) and from usage telemetry, which
 * uses its own secret.
 */
export function hashIpForRateLimit(
  ip: string,
  windowStart: Date,
  pepper: string = env.API_KEY_HASH_PEPPER,
): string {
  const day = windowStart.toISOString().slice(0, 10);
  const subkey = Buffer.from(
    crypto.hkdfSync("sha256", pepper, Buffer.alloc(0), `${RATE_LIMIT_IP_KEY_INFO_PREFIX}${day}`, 32),
  );
  return crypto.createHmac("sha256", subkey).update(ip).digest("hex");
}

/**
 * Deletes up to one batch each of expired per-IP buckets (older than a day)
 * and expired GLOBAL buckets (older than 90 days). Never reads or changes a
 * live bucket, so it can't affect any rate-limit decision.
 */
export async function sweepExpiredRateLimitWindows(
  db: AppDatabase,
  now: Date,
): Promise<{ perIp: number; global: number }> {
  const perIpCutoff = new Date(now.getTime() - PER_IP_RETENTION_MS);
  const globalCutoff = new Date(now.getTime() - GLOBAL_RETENTION_MS);
  const t = anonymousRateLimits;

  // Matched on the full primary key, so a batch is exactly CLEANUP_BATCH
  // rows at most, however many callers share a window.
  const expiredPerIp = db
    .select({ ipHash: t.ipHash, windowStart: t.windowStart })
    .from(t)
    .where(and(ne(t.ipHash, GLOBAL_RATE_LIMIT_KEY), lt(t.windowStart, perIpCutoff)))
    .orderBy(t.windowStart)
    .limit(CLEANUP_BATCH);
  const perIp = await db
    .delete(t)
    .where(sql`(${t.ipHash}, ${t.windowStart}) in (${expiredPerIp})`)
    .returning({ windowStart: t.windowStart });

  const expiredGlobal = db
    .select({ ipHash: t.ipHash, windowStart: t.windowStart })
    .from(t)
    .where(and(eq(t.ipHash, GLOBAL_RATE_LIMIT_KEY), lt(t.windowStart, globalCutoff)))
    .orderBy(t.windowStart)
    .limit(CLEANUP_BATCH);
  const global = await db
    .delete(t)
    .where(sql`(${t.ipHash}, ${t.windowStart}) in (${expiredGlobal})`)
    .returning({ windowStart: t.windowStart });

  return { perIp: perIp.length, global: global.length };
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
export type AnonymousRateLimitOptions = {
  /** Tests only. */
  now?: () => Date;
  /** Tests only: decides whether this call also sweeps expired buckets. */
  random?: () => number;
};

export async function checkAnonymousRateLimit(
  db: AppDatabase,
  request: Request,
  options: AnonymousRateLimitOptions = {},
): Promise<AnonymousRateLimitResult> {
  const ip = extractTrustedClientIp(request);
  if (!ip) {
    return { allowed: false, retryAfterSeconds: ANONYMOUS_RATE_LIMIT_WINDOW_SECONDS };
  }

  const now = (options.now ?? (() => new Date()))();
  const result = await decide(db, ip, now);

  // Opportunistic, bounded retention — only after the decision, and any
  // failure here is swallowed: it can never change the result above.
  if ((options.random ?? Math.random)() < CLEANUP_PROBABILITY) {
    try {
      await sweepExpiredRateLimitWindows(db, now);
    } catch {
      console.error("Anonymous rate limit cleanup failed.");
    }
  }
  return result;
}

async function decide(db: AppDatabase, ip: string, now: Date): Promise<AnonymousRateLimitResult> {
  try {
    const windowStart = currentWindowStart(now);
    const ipHash = hashIpForRateLimit(ip, windowStart);

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
