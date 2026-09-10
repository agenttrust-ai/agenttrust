import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, seedUser } from "@/lib/db/test-harness";
import type { AppDatabase } from "@/lib/db/rls";
import { createApiKey, revokeApiKey } from "@/lib/db/queries/api-keys";
import { DEFAULT_RATE_LIMIT_PER_WINDOW } from "@/lib/rate-limit/config";
import { checkRateLimit, withRateLimitedAuth } from "./rate-limit";
import { apiSuccess } from "./response";

const userA = "11111111-1111-1111-1111-111111111111";

let client: PGlite;
let db: AppDatabase;

beforeEach(async () => {
  const harness = await createTestDb();
  client = harness.client;
  db = harness.db;
  await seedUser(client, userA, "a@example.com");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
});

afterEach(async () => {
  vi.useRealTimers();
  await client.close();
});

function requestWith(header?: string): Request {
  const headers = new Headers();
  if (header !== undefined) headers.set("authorization", header);
  return new Request("https://example.com/api/v1/agents", { headers });
}

const okHandler = async () => apiSuccess({ ok: true });

describe("checkRateLimit", () => {
  it("allows a request comfortably under the limit", async () => {
    const { key } = await createApiKey(db, userA, { name: "k" });
    const result = await checkRateLimit(db, key.id);
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(DEFAULT_RATE_LIMIT_PER_WINDOW);
    expect(result.remaining).toBe(DEFAULT_RATE_LIMIT_PER_WINDOW - 1);
  });

  it("still allows the request that lands exactly on the limit", async () => {
    const { key } = await createApiKey(db, userA, { name: "k" });
    let last;
    for (let i = 0; i < DEFAULT_RATE_LIMIT_PER_WINDOW; i++) {
      last = await checkRateLimit(db, key.id);
    }
    expect(last!.allowed).toBe(true);
    expect(last!.remaining).toBe(0);
  });

  it("rejects the request one past the limit", async () => {
    const { key } = await createApiKey(db, userA, { name: "k" });
    for (let i = 0; i < DEFAULT_RATE_LIMIT_PER_WINDOW; i++) {
      await checkRateLimit(db, key.id);
    }
    const overLimit = await checkRateLimit(db, key.id);
    expect(overLimit.allowed).toBe(false);
    expect(overLimit.remaining).toBe(0);
  });

  it("resets once the window rolls over", async () => {
    const { key } = await createApiKey(db, userA, { name: "k" });
    for (let i = 0; i < DEFAULT_RATE_LIMIT_PER_WINDOW; i++) {
      await checkRateLimit(db, key.id);
    }
    expect((await checkRateLimit(db, key.id)).allowed).toBe(false);

    vi.setSystemTime(new Date("2026-01-01T00:01:00.000Z"));

    const afterReset = await checkRateLimit(db, key.id);
    expect(afterReset.allowed).toBe(true);
    expect(afterReset.remaining).toBe(DEFAULT_RATE_LIMIT_PER_WINDOW - 1);
  });

  it("keeps separate, independent quotas per API key", async () => {
    const { key: keyOne } = await createApiKey(db, userA, { name: "one" });
    const { key: keyTwo } = await createApiKey(db, userA, { name: "two" });

    for (let i = 0; i < DEFAULT_RATE_LIMIT_PER_WINDOW; i++) {
      await checkRateLimit(db, keyOne.id);
    }
    expect((await checkRateLimit(db, keyOne.id)).allowed).toBe(false);

    const stillFresh = await checkRateLimit(db, keyTwo.id);
    expect(stillFresh.allowed).toBe(true);
    expect(stillFresh.remaining).toBe(DEFAULT_RATE_LIMIT_PER_WINDOW - 1);
  });

  it("reset is a fixed point in the future, not a moving target within the same window", async () => {
    const { key } = await createApiKey(db, userA, { name: "k" });
    const first = await checkRateLimit(db, key.id);
    vi.setSystemTime(new Date("2026-01-01T00:00:30.000Z"));
    const second = await checkRateLimit(db, key.id);
    expect(second.reset).toBe(first.reset);
  });
});

describe("withRateLimitedAuth", () => {
  it("attaches X-RateLimit-* headers to a successful response", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const res = await withRateLimitedAuth(db, requestWith(`Bearer ${rawKey}`), okHandler);

    expect(res.status).toBe(200);
    expect(res.headers.get("X-RateLimit-Limit")).toBe(String(DEFAULT_RATE_LIMIT_PER_WINDOW));
    expect(res.headers.get("X-RateLimit-Remaining")).toBe(String(DEFAULT_RATE_LIMIT_PER_WINDOW - 1));
    expect(res.headers.get("X-RateLimit-Reset")).toBeTruthy();
  });

  it("returns 429 with the standard error shape once the limit is exceeded", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    for (let i = 0; i < DEFAULT_RATE_LIMIT_PER_WINDOW; i++) {
      await withRateLimitedAuth(db, requestWith(`Bearer ${rawKey}`), okHandler);
    }

    const res = await withRateLimitedAuth(db, requestWith(`Bearer ${rawKey}`), okHandler);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThanOrEqual(0);
  });

  it("never runs the handler once the limit is exceeded", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    for (let i = 0; i < DEFAULT_RATE_LIMIT_PER_WINDOW; i++) {
      await withRateLimitedAuth(db, requestWith(`Bearer ${rawKey}`), okHandler);
    }

    const handler = vi.fn(okHandler);
    await withRateLimitedAuth(db, requestWith(`Bearer ${rawKey}`), handler);
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects a missing API key without touching any counter, and without rate-limit headers", async () => {
    const res = await withRateLimitedAuth(db, requestWith(undefined), okHandler);
    expect(res.status).toBe(401);
    expect(res.headers.get("X-RateLimit-Limit")).toBeNull();

    const rows = await client.query<{ n: number }>(`select count(*)::int as n from public.usage_counters`);
    expect(rows.rows[0].n).toBe(0);
  });

  it("rejects an invalid API key without consuming any real key's quota", async () => {
    const { rawKey, key } = await createApiKey(db, userA, { name: "real" });

    for (let i = 0; i < 5; i++) {
      const res = await withRateLimitedAuth(
        db,
        requestWith(`Bearer at_live_${"x".repeat(43)}`),
        okHandler,
      );
      expect(res.status).toBe(401);
    }

    const first = await withRateLimitedAuth(db, requestWith(`Bearer ${rawKey}`), okHandler);
    const body = await first.json();
    expect(body.data).toEqual({ ok: true });
    expect(first.headers.get("X-RateLimit-Remaining")).toBe(String(DEFAULT_RATE_LIMIT_PER_WINDOW - 1));

    const rows = await client.query<{ api_key_id: string }>(
      `select api_key_id from public.usage_counters`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].api_key_id).toBe(key.id);
  });

  it("rejects a revoked API key as 401 and does not consume quota", async () => {
    const { rawKey, key } = await createApiKey(db, userA, { name: "will revoke" });
    await revokeApiKey(db, userA, key.id);

    const res = await withRateLimitedAuth(db, requestWith(`Bearer ${rawKey}`), okHandler);
    expect(res.status).toBe(401);

    const rows = await client.query<{ n: number }>(`select count(*)::int as n from public.usage_counters`);
    expect(rows.rows[0].n).toBe(0);
  });

  it("still updates last_used_at on a successful rate-limited call", async () => {
    const { rawKey, key } = await createApiKey(db, userA, { name: "k" });
    await withRateLimitedAuth(db, requestWith(`Bearer ${rawKey}`), okHandler);

    const rows = await client.query<{ last_used_at: string | null }>(
      `select last_used_at from public.api_keys where id = $1`,
      [key.id],
    );
    expect(rows.rows[0].last_used_at).not.toBeNull();
  });

  it("is concurrency-safe end to end: exactly `limit` of many parallel requests succeed", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "burst" });
    const burst = DEFAULT_RATE_LIMIT_PER_WINDOW + 20;

    const responses = await Promise.all(
      Array.from({ length: burst }, () =>
        withRateLimitedAuth(db, requestWith(`Bearer ${rawKey}`), okHandler),
      ),
    );

    const succeeded = responses.filter((r) => r.status === 200).length;
    const limited = responses.filter((r) => r.status === 429).length;
    expect(succeeded).toBe(DEFAULT_RATE_LIMIT_PER_WINDOW);
    expect(limited).toBe(burst - DEFAULT_RATE_LIMIT_PER_WINDOW);
  });
});
