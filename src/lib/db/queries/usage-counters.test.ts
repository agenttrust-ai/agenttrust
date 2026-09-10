import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, seedUser } from "@/lib/db/test-harness";
import type { AppDatabase } from "@/lib/db/rls";
import { createApiKey } from "@/lib/db/queries/api-keys";
import { incrementUsageCounter } from "./usage-counters";

const userA = "11111111-1111-1111-1111-111111111111";

let client: PGlite;
let db: AppDatabase;

beforeEach(async () => {
  const harness = await createTestDb();
  client = harness.client;
  db = harness.db;
  await seedUser(client, userA, "a@example.com");
});

afterEach(async () => {
  await client.close();
});

const windowA = new Date("2026-01-01T00:00:00.000Z");
const windowB = new Date("2026-01-01T00:01:00.000Z");

describe("incrementUsageCounter", () => {
  it("starts a window at 1 on the first increment", async () => {
    const { key } = await createApiKey(db, userA, { name: "k" });
    const count = await incrementUsageCounter(db, key.id, windowA);
    expect(count).toBe(1);
  });

  it("increments the same key+window across calls", async () => {
    const { key } = await createApiKey(db, userA, { name: "k" });
    await incrementUsageCounter(db, key.id, windowA);
    await incrementUsageCounter(db, key.id, windowA);
    const count = await incrementUsageCounter(db, key.id, windowA);
    expect(count).toBe(3);
  });

  it("keeps separate counters for separate windows of the same key", async () => {
    const { key } = await createApiKey(db, userA, { name: "k" });
    await incrementUsageCounter(db, key.id, windowA);
    await incrementUsageCounter(db, key.id, windowA);
    const secondWindowCount = await incrementUsageCounter(db, key.id, windowB);
    expect(secondWindowCount).toBe(1);

    const rows = await client.query<{ request_count: number }>(
      `select request_count from public.usage_counters where api_key_id = $1 order by window_start`,
      [key.id],
    );
    expect(rows.rows.map((r) => r.request_count)).toEqual([2, 1]);
  });

  it("keeps separate counters for separate API keys in the same window", async () => {
    const { key: keyOne } = await createApiKey(db, userA, { name: "one" });
    const { key: keyTwo } = await createApiKey(db, userA, { name: "two" });

    await incrementUsageCounter(db, keyOne.id, windowA);
    await incrementUsageCounter(db, keyOne.id, windowA);
    const countTwo = await incrementUsageCounter(db, keyTwo.id, windowA);

    expect(countTwo).toBe(1);
    const countOneAgain = await incrementUsageCounter(db, keyOne.id, windowA);
    expect(countOneAgain).toBe(3);
  });

  it("is concurrency-safe: N parallel increments for the same key+window land on exactly N, never fewer", async () => {
    const { key } = await createApiKey(db, userA, { name: "concurrent" });
    const N = 25;

    const counts = await Promise.all(
      Array.from({ length: N }, () => incrementUsageCounter(db, key.id, windowA)),
    );

    // Every increment must have returned a distinct value 1..N — a lost
    // update (two requests reading the same pre-increment count) would show
    // up as a duplicate value in this set.
    expect(new Set(counts).size).toBe(N);
    expect(Math.max(...counts)).toBe(N);

    const rows = await client.query<{ request_count: number }>(
      `select request_count from public.usage_counters where api_key_id = $1`,
      [key.id],
    );
    expect(rows.rows[0].request_count).toBe(N);
  });
});
