/**
 * Manually-invoked only — NOT wired into any cron or route. Run with:
 *
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/import-public-agents.ts <insertLimit>
 *
 * `insertLimit` (default 10, max 50) caps how many new agents this run may
 * insert — it does not raise the registry fetch itself, which is always
 * bounded to 50 candidates regardless.
 *
 * `.env.local`'s own `DATABASE_URL` (the pooled connection) is not valid
 * outside the deployed app; `DIRECT_URL` is the one that actually connects
 * from a standalone script. Remapped here, in memory only, before `@/lib/db`
 * is ever imported — never logged, never written anywhere.
 */
if (process.env.DIRECT_URL) {
  process.env.DATABASE_URL = process.env.DIRECT_URL;
}

async function main() {
  const arg = process.argv[2];
  const insertLimit = arg ? Number(arg) : 10;
  if (!Number.isInteger(insertLimit) || insertLimit < 1 || insertLimit > 50) {
    console.error("Usage: import-public-agents.ts <insertLimit 1-50> (default 10)");
    process.exit(1);
  }

  const { db } = await import("@/lib/db");
  const { importPublicAgents } = await import("@/lib/discovery/import-public-agents");

  const summary = await importPublicAgents(db, { fetchLimit: 50, insertLimit });

  console.log(
    JSON.stringify(
      {
        discovered: summary.discovered,
        insertedCount: summary.inserted.length,
        inserted: summary.inserted.map((a) => ({
          id: a.id,
          slug: a.slug,
          name: a.name,
          endpointUrl: a.endpointUrl,
          source: a.source,
          ownerId: a.ownerId,
          ownershipVerifiedAt: a.ownershipVerifiedAt,
          lifecycleStatus: a.lifecycleStatus,
          visibility: a.visibility,
        })),
        filteredCount: summary.filtered.length,
        filtered: summary.filtered,
        duplicatesSkippedCount: summary.duplicatesSkipped.length,
        duplicatesSkipped: summary.duplicatesSkipped,
        cappedBeforeInsertCount: summary.cappedBeforeInsert.length,
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Import failed:", error);
    process.exit(1);
  });
