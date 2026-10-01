import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb } from "@/lib/db/test-harness";
import type { AppDatabase } from "@/lib/db/rls";
import crypto from "node:crypto";
import { env } from "@/lib/config.server";
import { hashApiKey } from "@/lib/security/api-keys";
import { CALLER_KEY_INFO_PREFIX, callerKeyPeriod, deriveTelemetrySubkey } from "@/lib/telemetry/trust-check-events";
import {
  ANONYMOUS_RATE_LIMIT_GLOBAL,
  ANONYMOUS_RATE_LIMIT_PER_IP,
  ANONYMOUS_RATE_LIMIT_WINDOW_SECONDS,
  GLOBAL_RETENTION_MS,
  PER_IP_RETENTION_MS,
  RATE_LIMIT_IP_KEY_INFO_PREFIX,
  checkAnonymousRateLimit,
  extractTrustedClientIp,
  hashIpForRateLimit,
  sweepExpiredRateLimitWindows,
} from "./anonymous-rate-limit";

let client: PGlite;
let db: AppDatabase;

beforeEach(async () => {
  const harness = await createTestDb();
  client = harness.client;
  db = harness.db;
});

afterEach(async () => {
  await client.close();
});

function requestWithIp(ip: string | null, headerName = "x-vercel-forwarded-for"): Request {
  const headers = new Headers();
  if (ip) headers.set(headerName, ip);
  return new Request("https://agenttrust-umber.vercel.app/api/mcp", { headers });
}

describe("extractTrustedClientIp", () => {
  it("prefers x-vercel-forwarded-for over the other headers", () => {
    const headers = new Headers({
      "x-vercel-forwarded-for": "1.1.1.1",
      "x-forwarded-for": "2.2.2.2",
      "x-real-ip": "3.3.3.3",
    });
    const request = new Request("https://example.com", { headers });
    expect(extractTrustedClientIp(request)).toBe("1.1.1.1");
  });

  it("falls back to x-forwarded-for when x-vercel-forwarded-for is absent", () => {
    const headers = new Headers({ "x-forwarded-for": "2.2.2.2", "x-real-ip": "3.3.3.3" });
    const request = new Request("https://example.com", { headers });
    expect(extractTrustedClientIp(request)).toBe("2.2.2.2");
  });

  it("falls back to x-real-ip when only that is present", () => {
    const headers = new Headers({ "x-real-ip": "3.3.3.3" });
    const request = new Request("https://example.com", { headers });
    expect(extractTrustedClientIp(request)).toBe("3.3.3.3");
  });

  it("takes only the first entry of a comma-separated list", () => {
    const headers = new Headers({ "x-forwarded-for": "9.9.9.9, 8.8.8.8" });
    const request = new Request("https://example.com", { headers });
    expect(extractTrustedClientIp(request)).toBe("9.9.9.9");
  });

  it("returns null when no IP header is present at all", () => {
    const request = new Request("https://example.com");
    expect(extractTrustedClientIp(request)).toBeNull();
  });
});

describe("checkAnonymousRateLimit", () => {
  it("allows requests under the per-IP limit", async () => {
    const request = requestWithIp("203.0.113.1");
    for (let i = 0; i < ANONYMOUS_RATE_LIMIT_PER_IP; i++) {
      const result = await checkAnonymousRateLimit(db, request);
      expect(result.allowed).toBe(true);
    }
  });

  it("blocks the request that exceeds the per-IP limit, with a positive retryAfterSeconds", async () => {
    const request = requestWithIp("203.0.113.2");
    for (let i = 0; i < ANONYMOUS_RATE_LIMIT_PER_IP; i++) {
      await checkAnonymousRateLimit(db, request);
    }
    const result = await checkAnonymousRateLimit(db, request);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
      expect(result.retryAfterSeconds).toBeLessThanOrEqual(ANONYMOUS_RATE_LIMIT_WINDOW_SECONDS);
    }
  });

  it("gives independent buckets to different IPs", async () => {
    const requestA = requestWithIp("203.0.113.10");
    const requestB = requestWithIp("203.0.113.20");

    for (let i = 0; i < ANONYMOUS_RATE_LIMIT_PER_IP; i++) {
      await checkAnonymousRateLimit(db, requestA);
    }
    const blockedA = await checkAnonymousRateLimit(db, requestA);
    expect(blockedA.allowed).toBe(false);

    const allowedB = await checkAnonymousRateLimit(db, requestB);
    expect(allowedB.allowed).toBe(true);
  });

  it("resets after the fixed window rolls over", async () => {
    const request = requestWithIp("203.0.113.30");
    for (let i = 0; i < ANONYMOUS_RATE_LIMIT_PER_IP; i++) {
      await checkAnonymousRateLimit(db, request);
    }
    expect((await checkAnonymousRateLimit(db, request)).allowed).toBe(false);

    // Simulate the window having rolled over by backdating this IP's row
    // directly, the same technique already used elsewhere in this test
    // suite for cooldown-window tests.
    const past = new Date(Date.now() - (ANONYMOUS_RATE_LIMIT_WINDOW_SECONDS + 5) * 1000);
    await client.query(`update public.anonymous_rate_limits set window_start = $1`, [
      past.toISOString(),
    ]);

    const result = await checkAnonymousRateLimit(db, request);
    expect(result.allowed).toBe(true);
  });

  it("never stores the raw IP address — only a hash", async () => {
    const request = requestWithIp("198.51.100.42");
    await checkAnonymousRateLimit(db, request);

    // Excludes the GLOBAL sentinel row this same call also writes (the
    // aggregate safety-cap counter, not a per-IP bucket) — it's a literal
    // string by design, not a hash.
    const rows = await client.query<{ ip_hash: string }>(
      `select ip_hash from public.anonymous_rate_limits where ip_hash <> 'GLOBAL'`,
    );
    expect(rows.rows.length).toBeGreaterThan(0);
    for (const row of rows.rows) {
      expect(row.ip_hash).not.toContain("198.51.100.42");
      expect(row.ip_hash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex digest shape
      // Keyed, not the reversible unsalted SHA-256 of the IP.
      expect(row.ip_hash).not.toBe(crypto.createHash("sha256").update("198.51.100.42").digest("hex"));
    }
  });

  it("enforces the global aggregate cap once enough distinct IPs combine to exceed it", async () => {
    // Drive the GLOBAL bucket directly to just under its cap, then confirm
    // one more request (from a brand-new IP, itself nowhere near its own
    // per-IP limit) still gets blocked by the aggregate cap.
    const justUnderCap = new Date(Math.floor(Date.now() / 1000 / ANONYMOUS_RATE_LIMIT_WINDOW_SECONDS) * ANONYMOUS_RATE_LIMIT_WINDOW_SECONDS * 1000);
    await client.query(
      `insert into public.anonymous_rate_limits (ip_hash, window_start, request_count) values ('GLOBAL', $1, $2)`,
      [justUnderCap.toISOString(), ANONYMOUS_RATE_LIMIT_GLOBAL],
    );

    const freshIpRequest = requestWithIp("203.0.113.99");
    const result = await checkAnonymousRateLimit(db, freshIpRequest);
    expect(result.allowed).toBe(false);
  });

  it("fails closed when no trustworthy IP signal is present", async () => {
    const request = requestWithIp(null);
    const result = await checkAnonymousRateLimit(db, request);
    expect(result.allowed).toBe(false);
  });

  it("fails closed when the rate-limit state cannot be checked (simulated DB failure)", async () => {
    const brokenDb = {
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: () => ({
            returning: () => Promise.reject(new Error("simulated db failure")),
          }),
        }),
      }),
    } as unknown as AppDatabase;

    const request = requestWithIp("203.0.113.55");
    const result = await checkAnonymousRateLimit(brokenDb, request);
    expect(result.allowed).toBe(false);
  });

  it("concurrent requests from the same IP cannot exceed the intended limit (atomic claim)", async () => {
    const request = requestWithIp("203.0.113.77");
    const attempts = ANONYMOUS_RATE_LIMIT_PER_IP + 10;

    const results = await Promise.all(
      Array.from({ length: attempts }, () => checkAnonymousRateLimit(db, request)),
    );

    const allowedCount = results.filter((r) => r.allowed).length;
    expect(allowedCount).toBe(ANONYMOUS_RATE_LIMIT_PER_IP);
  });
});

describe("rate-limit IP hash — keyed, domain-separated, rotating daily (UTC)", () => {
  const ip = "198.51.100.42";
  const window = new Date("2026-10-01T12:34:00.000Z");
  const pepper = env.API_KEY_HASH_PEPPER;

  it("is HMAC-SHA256 of the IP under an HKDF subkey labelled for this purpose and day", () => {
    const subkey = Buffer.from(
      crypto.hkdfSync("sha256", pepper, Buffer.alloc(0), `${RATE_LIMIT_IP_KEY_INFO_PREFIX}2026-10-01`, 32),
    );
    expect(hashIpForRateLimit(ip, window)).toBe(crypto.createHmac("sha256", subkey).update(ip).digest("hex"));
  });

  it("is not the raw IP, the plain SHA-256, an API-key hash, or telemetry's caller key", () => {
    const hash = hashIpForRateLimit(ip, window);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(ip);
    expect(hash).not.toBe(crypto.createHash("sha256").update(ip).digest("hex"));
    expect(hash).not.toBe(hashApiKey(ip, pepper));
    // Even if telemetry used the same secret, its subkey label differs.
    const telemetrySubkey = deriveTelemetrySubkey(pepper, `${CALLER_KEY_INFO_PREFIX}${callerKeyPeriod(window)}`);
    expect(hash).not.toBe(crypto.createHmac("sha256", telemetrySubkey).update(ip).digest("hex"));
  });

  it("depends on the secret", () => {
    expect(hashIpForRateLimit(ip, window, "x".repeat(48))).not.toBe(hashIpForRateLimit(ip, window));
  });

  it("is the same all day and different the next UTC day", () => {
    const sameDayEarly = new Date("2026-10-01T00:00:00.000Z");
    const sameDayLate = new Date("2026-10-01T23:59:00.000Z");
    const nextDay = new Date("2026-10-02T00:00:00.000Z");
    expect(hashIpForRateLimit(ip, sameDayEarly)).toBe(hashIpForRateLimit(ip, sameDayLate));
    expect(hashIpForRateLimit(ip, nextDay)).not.toBe(hashIpForRateLimit(ip, sameDayLate));
  });

  it("never splits a window across two keys: UTC midnight is always a window boundary", () => {
    expect((24 * 60 * 60) % ANONYMOUS_RATE_LIMIT_WINDOW_SECONDS).toBe(0);
  });

  it("stores exactly the keyed hash for the request's window", async () => {
    const now = new Date("2026-10-01T12:34:56.000Z");
    await checkAnonymousRateLimit(db, requestWithIp(ip), { now: () => now, random: () => 1 });
    const rows = await client.query<{ ip_hash: string }>(
      `select ip_hash from public.anonymous_rate_limits where ip_hash <> 'GLOBAL'`,
    );
    expect(rows.rows.map((r) => r.ip_hash)).toEqual([hashIpForRateLimit(ip, window)]);
  });

  it("keeps enforcing the per-IP limit right up to midnight, and starts fresh in the next day's first window", async () => {
    const lateWindow = () => new Date("2026-10-01T23:59:30.000Z");
    for (let i = 0; i < ANONYMOUS_RATE_LIMIT_PER_IP; i++) {
      expect((await checkAnonymousRateLimit(db, requestWithIp(ip), { now: lateWindow, random: () => 1 })).allowed).toBe(true);
    }
    expect((await checkAnonymousRateLimit(db, requestWithIp(ip), { now: lateWindow, random: () => 1 })).allowed).toBe(false);
    const nextDay = () => new Date("2026-10-02T00:00:10.000Z");
    expect((await checkAnonymousRateLimit(db, requestWithIp(ip), { now: nextDay, random: () => 1 })).allowed).toBe(true);
  });
});

describe("rate-limit retention cleanup", () => {
  const now = new Date("2026-10-01T12:00:00.000Z");
  const hours = (n: number) => n * 60 * 60 * 1000;

  async function seed(ipHash: string, windowStart: Date) {
    await client.query(
      `insert into public.anonymous_rate_limits (ip_hash, window_start, request_count) values ($1, $2, 1)`,
      [ipHash, windowStart],
    );
  }
  const keys = async () =>
    (await client.query<{ ip_hash: string }>(`select ip_hash from public.anonymous_rate_limits order by ip_hash`)).rows.map(
      (r) => r.ip_hash,
    );

  it("deletes per-IP buckets older than a day and GLOBAL buckets older than 90 days, keeping the rest", async () => {
    await seed("a".repeat(64), new Date(now.getTime() - PER_IP_RETENTION_MS - hours(1)));
    await seed("b".repeat(64), new Date(now.getTime() - PER_IP_RETENTION_MS + hours(1)));
    await seed("GLOBAL", new Date(now.getTime() - GLOBAL_RETENTION_MS - hours(1)));
    await seed("GLOBAL", new Date(now.getTime() - PER_IP_RETENTION_MS - hours(1)));

    expect(await sweepExpiredRateLimitWindows(db, now)).toEqual({ perIp: 1, global: 1 });
    expect(await keys()).toEqual(["GLOBAL", "b".repeat(64)]);
  });

  it("deletes at most one batch per sweep, even when many callers share a window", async () => {
    const old = new Date(now.getTime() - PER_IP_RETENTION_MS - hours(2));
    await client.query(
      `insert into public.anonymous_rate_limits (ip_hash, window_start, request_count)
         select lpad(to_hex(n), 64, '0'), $1, 1 from generate_series(1, 1005) n`,
      [old],
    );
    expect((await sweepExpiredRateLimitWindows(db, now)).perIp).toBe(1000);
    expect((await keys()).length).toBe(5);
  });

  it("runs opportunistically from the rate-limit check only when selected", async () => {
    await seed("a".repeat(64), new Date(now.getTime() - PER_IP_RETENTION_MS - hours(1)));
    await checkAnonymousRateLimit(db, requestWithIp("203.0.113.1"), { now: () => now, random: () => 1 });
    expect(await keys()).toContain("a".repeat(64));
    await checkAnonymousRateLimit(db, requestWithIp("203.0.113.1"), { now: () => now, random: () => 0 });
    expect(await keys()).not.toContain("a".repeat(64));
  });

  it("a cleanup failure never changes the decision — neither allowing nor blocking", async () => {
    const failingCleanupDb = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "delete") {
          return () => {
            throw new Error("simulated cleanup failure");
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as AppDatabase;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const opts = { now: () => now, random: () => 0 };
    for (let i = 0; i < ANONYMOUS_RATE_LIMIT_PER_IP; i++) {
      expect((await checkAnonymousRateLimit(failingCleanupDb, requestWithIp("203.0.113.2"), opts)).allowed).toBe(true);
    }
    expect((await checkAnonymousRateLimit(failingCleanupDb, requestWithIp("203.0.113.2"), opts)).allowed).toBe(false);
    expect(JSON.stringify(errors.mock.calls)).not.toContain("203.0.113.2");
    errors.mockRestore();
  });
});
