import "server-only";
import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";
import { AppError } from "@/lib/errors";

/**
 * A Drizzle database or transaction handle over our schema — deliberately
 * loose about which driver (postgres.js in production, PGlite in tests)
 * produced it, so the query functions in `queries/` work against either.
 */
export type AppDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * Runs `fn` inside a transaction with the Postgres session configured as the
 * given user would be if they'd connected through Supabase's own API layer:
 * role `authenticated`, with `auth.uid()` resolving to their id. The RLS
 * policies in supabase/migrations/0001_rls_and_triggers.sql then apply for
 * real — this is not decorative SQL, it's the second enforcement layer
 * alongside the `ownerId` filter every query below also applies.
 *
 * `userId` must already be a verified session's user id (from
 * `verifySession()`), never an unverified client-supplied value — this
 * function trusts its caller on that point.
 */
export async function withUserContext<T>(
  db: AppDatabase,
  userId: string,
  fn: (tx: AppDatabase) => Promise<T>,
): Promise<T> {
  return runTransaction(db, async (tx) => {
    await tx.execute(
      sql`select set_config('request.jwt.claim.sub', ${userId}, true)`,
    );
    await tx.execute(sql`set local role authenticated`);
    return fn(tx);
  });
}

/** Same, but as Supabase's anonymous role — for reads with no signed-in user. */
export async function withAnonContext<T>(
  db: AppDatabase,
  fn: (tx: AppDatabase) => Promise<T>,
): Promise<T> {
  return runTransaction(db, async (tx) => {
    await tx.execute(sql`set local role anon`);
    return fn(tx);
  });
}

async function runTransaction<T>(
  db: AppDatabase,
  fn: (tx: AppDatabase) => Promise<T>,
): Promise<T> {
  return withDbErrorNormalization(() =>
    db.transaction((tx) => fn(tx as unknown as AppDatabase)),
  );
}

/**
 * A connection failure (e.g. no database reachable) rejects with a Node
 * `AggregateError` wrapping one error per address family tried. Left as-is,
 * that shape has tripped up Next.js's dev-mode error handling badly enough
 * to take the whole dev server down instead of rendering `error.tsx`.
 * Normalizing to a plain `Error` here — every DB call in the app, including
 * the service-context ones in queries/health-checks.ts that don't go
 * through `withUserContext`/`withAnonContext`, should wrap its call with
 * this — fixes that everywhere at once. `AppError`s (NOT_FOUND, etc.,
 * thrown intentionally by a query) pass through untouched.
 */
export async function withDbErrorNormalization<T>(
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof AppError) throw error;
    const message = error instanceof Error ? error.message : "Database error";
    console.error(error);
    throw new Error(message);
  }
}
