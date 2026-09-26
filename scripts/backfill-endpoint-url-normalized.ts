/**
 * Manually-invoked only — NOT wired into any cron or route. Brings every
 * agent's `endpoint_url_normalized` in line with
 * `normalizeEndpointUrlForLookup(endpoint_url)`; safe to re-run any number
 * of times (see `reconcileEndpointUrlNormalized`). Dry run unless `--apply`
 * is passed:
 *
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/backfill-endpoint-url-normalized.ts
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/backfill-endpoint-url-normalized.ts --apply
 *
 * Requires migration 0008 (the column) to already be applied to whatever
 * database `.env.local` points at. Prints only aggregate counts — never
 * endpoint URLs or any other row data.
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
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== "--apply");
  if (unknown.length > 0) {
    console.error("Usage: backfill-endpoint-url-normalized.ts [--apply]");
    process.exit(1);
  }
  const dryRun = !args.includes("--apply");

  const { db } = await import("@/lib/db");
  const { reconcileEndpointUrlNormalized } = await import(
    "@/lib/db/queries/endpoint-url-normalized"
  );

  const result = await reconcileEndpointUrlNormalized(db, { dryRun });
  console.log(JSON.stringify(result, null, 2));
  if (dryRun && result.outOfSync > 0) {
    console.log(`Dry run: ${result.outOfSync} row(s) would be updated. Re-run with --apply to write.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exit(1);
  });

// A module (not a global script), so `main` can't collide with the other
// scripts' own top-level `main` under `tsc --noEmit`.
export {};
