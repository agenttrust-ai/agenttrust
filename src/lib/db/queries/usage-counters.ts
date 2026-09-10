import "server-only";
import { sql } from "drizzle-orm";
import { usageCounters } from "@/lib/db/schema";
import { withDbErrorNormalization, type AppDatabase } from "@/lib/db/rls";

/**
 * Atomically increments the request counter for one API key's current
 * rate-limit window and returns the count *after* the increment.
 *
 * A single `INSERT ... ON CONFLICT DO UPDATE` is the whole concurrency
 * story: Postgres serializes conflicting writes on the unique
 * `(api_key_id, window_start)` index itself, so two requests racing for the
 * same window can never both read the same pre-increment count and both
 * proceed — one always sees the other's increment. No app-level locking
 * needed.
 *
 * Runs as the trusted service context (same as `verifyApiKey`'s
 * `last_used_at` update) — there's no end-user session to scope this to,
 * and `usage_counters` intentionally has no RLS write policy for
 * `authenticated`/`anon` (see supabase/migrations/0001_rls_and_triggers.sql).
 */
export async function incrementUsageCounter(
  db: AppDatabase,
  apiKeyId: string,
  windowStart: Date,
): Promise<number> {
  return withDbErrorNormalization(async () => {
    const [row] = await db
      .insert(usageCounters)
      .values({ apiKeyId, windowStart, requestCount: 1 })
      .onConflictDoUpdate({
        target: [usageCounters.apiKeyId, usageCounters.windowStart],
        set: { requestCount: sql`${usageCounters.requestCount} + 1` },
      })
      .returning({ requestCount: usageCounters.requestCount });
    return row.requestCount;
  });
}
