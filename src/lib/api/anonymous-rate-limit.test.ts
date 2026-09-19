import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb } from "@/lib/db/test-harness";
import type { AppDatabase } from "@/lib/db/rls";
import {
  ANONYMOUS_RATE_LIMIT_GLOBAL,
  ANONYMOUS_RATE_LIMIT_PER_IP,
  ANONYMOUS_RATE_LIMIT_WINDOW_SECONDS,
  checkAnonymousRateLimit,
  extractTrustedClientIp,
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
