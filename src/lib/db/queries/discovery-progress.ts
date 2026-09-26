import "server-only";
import { and, count, desc, eq, gte, isNotNull, like } from "drizzle-orm";
import { agents, auditLog } from "@/lib/db/schema";
import { withDbErrorNormalization, type AppDatabase } from "@/lib/db/rls";

/** Longest registry cursor we'll trust from a stored row — anything else is treated as "start over". */
const MAX_STORED_CURSOR_LENGTH = 512;

/**
 * A discovery run's own record of what it did and where the next run should
 * resume. Stored as an `audit_log` row (`actor_id` null — the system, not a
 * user — so the table's only read policy, `actor_id = auth.uid()`, exposes
 * it to no one). Counts and registry cursors only: never candidate URLs,
 * names, or anything secret.
 */
export type DiscoveryRunRecord = {
  /** Cursor the next run should start from; `null` means "from the beginning". */
  resumeCursor: string | null;
  [key: string]: unknown;
};

/**
 * The resume cursor from the most recent run of `action`, or `null` when
 * there is none yet (or the stored value isn't a usable cursor) — both mean
 * "start from the first page", which is always safe: already-known agents
 * are de-duplicated, not re-inserted.
 */
export async function getLatestDiscoveryResumeCursor(
  db: AppDatabase,
  action: string,
): Promise<string | null> {
  return withDbErrorNormalization(async () => {
    const [row] = await db
      .select({ metadata: auditLog.metadata })
      .from(auditLog)
      .where(eq(auditLog.action, action))
      .orderBy(desc(auditLog.createdAt))
      .limit(1);
    const cursor = (row?.metadata as { resumeCursor?: unknown } | undefined)
      ?.resumeCursor;
    return typeof cursor === "string" &&
      cursor.length > 0 &&
      cursor.length <= MAX_STORED_CURSOR_LENGTH
      ? cursor
      : null;
  });
}

/** Appends one run record. Service context — the same unwrapped connection the cron writes already use. */
export async function recordDiscoveryRun(
  db: AppDatabase,
  action: string,
  record: DiscoveryRunRecord,
): Promise<void> {
  await withDbErrorNormalization(() =>
    db.insert(auditLog).values({
      actorId: null,
      agentId: null,
      action,
      metadata: record,
    }),
  );
}

/**
 * How many agents a given discovery source has inserted since `since` —
 * identified by its `externalRegistryId` prefix. Lets a daily cap hold
 * across runs, not just within one (e.g. a duplicate cron invocation).
 */
export async function countAgentsDiscoveredSince(
  db: AppDatabase,
  registryIdPrefix: string,
  since: Date,
): Promise<number> {
  return withDbErrorNormalization(async () => {
    const [row] = await db
      .select({ n: count() })
      .from(agents)
      .where(
        and(
          like(agents.externalRegistryId, `${registryIdPrefix}%`),
          isNotNull(agents.discoveredAt),
          gte(agents.discoveredAt, since),
        ),
      );
    return Number(row?.n ?? 0);
  });
}
