import "server-only";
import { and, asc, eq, gt } from "drizzle-orm";
import { agents } from "@/lib/db/schema";
import { withDbErrorNormalization, type AppDatabase } from "@/lib/db/rls";
import { normalizeEndpointUrlForLookup } from "./agents";

const DEFAULT_BATCH_SIZE = 500;

/**
 * Sets one agent's `endpoint_url_normalized` — but only if its
 * `endpoint_url` is still exactly the value the normalization was computed
 * from. If the endpoint changed in between (an owner edit, or anything else
 * writing the row), nothing is written: whatever wrote the new endpoint is
 * responsible for its normalization, and a later reconcile run picks up
 * anything still out of sync. Returns whether the row was updated.
 *
 * Touches no other column — in particular not `updated_at`, which means
 * "the owner changed something", and this is derived data.
 */
export async function setNormalizedEndpointIfUnchanged(
  db: AppDatabase,
  row: { id: string; expectedEndpointUrl: string; normalized: string | null },
): Promise<boolean> {
  return withDbErrorNormalization(async () => {
    const updated = await db
      .update(agents)
      .set({ endpointUrlNormalized: row.normalized })
      .where(and(eq(agents.id, row.id), eq(agents.endpointUrl, row.expectedEndpointUrl)))
      .returning({ id: agents.id });
    return updated.length > 0;
  });
}

export type EndpointUrlNormalizedReconcileResult = {
  dryRun: boolean;
  /** Every agent row examined, regardless of owner/visibility/lifecycle. */
  scanned: number;
  /** Stored value already equals `normalizeEndpointUrlForLookup(endpointUrl)`. */
  alreadyInSync: number;
  /** Rows whose stored value differs (including NULL-but-normalizable). */
  outOfSync: number;
  /** Rows actually written — always 0 on a dry run. */
  updated: number;
  /** Out-of-sync rows skipped because `endpoint_url` changed mid-run. */
  skippedConcurrentChange: number;
  /** Rows whose endpoint can't be normalized at all (stay/become NULL, never match). */
  unnormalizable: number;
};

/**
 * Backfill and reconcile in one: brings every agent's
 * `endpoint_url_normalized` in line with
 * `normalizeEndpointUrlForLookup(endpoint_url)` — the one normalization
 * implementation, never a SQL re-implementation of it. Idempotent: a
 * second run over unchanged data finds every row already in sync and
 * writes nothing. Dry run by default; only `dryRun: false` writes.
 *
 * Runs as the unwrapped service connection (like discovery and monitoring)
 * because it must see every row — drafts and unlisted agents included —
 * and reads in id-ordered batches so memory stays bounded however large
 * the table gets. Not wired into any cron or route; see
 * scripts/backfill-endpoint-url-normalized.ts.
 */
export async function reconcileEndpointUrlNormalized(
  db: AppDatabase,
  options: { dryRun: boolean; batchSize?: number },
): Promise<EndpointUrlNormalizedReconcileResult> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const result: EndpointUrlNormalizedReconcileResult = {
    dryRun: options.dryRun,
    scanned: 0,
    alreadyInSync: 0,
    outOfSync: 0,
    updated: 0,
    skippedConcurrentChange: 0,
    unnormalizable: 0,
  };

  let afterId: string | null = null;
  for (;;) {
    const batch = await withDbErrorNormalization(() =>
      db
        .select({
          id: agents.id,
          endpointUrl: agents.endpointUrl,
          endpointUrlNormalized: agents.endpointUrlNormalized,
        })
        .from(agents)
        .where(afterId ? gt(agents.id, afterId) : undefined)
        .orderBy(asc(agents.id))
        .limit(batchSize),
    );
    if (batch.length === 0) break;

    for (const row of batch) {
      result.scanned++;
      const normalized = normalizeEndpointUrlForLookup(row.endpointUrl);
      if (normalized === null) result.unnormalizable++;
      if (row.endpointUrlNormalized === normalized) {
        result.alreadyInSync++;
        continue;
      }
      result.outOfSync++;
      if (options.dryRun) continue;

      const wrote = await setNormalizedEndpointIfUnchanged(db, {
        id: row.id,
        expectedEndpointUrl: row.endpointUrl,
        normalized,
      });
      if (wrote) result.updated++;
      else result.skippedConcurrentChange++;
    }

    afterId = batch[batch.length - 1].id;
    if (batch.length < batchSize) break;
  }

  return result;
}
