import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "./schema";
import type { AppDatabase } from "./rls";

const PROJECT_ROOT = path.resolve(__dirname, "../../..");

/**
 * A real embedded Postgres (via PGlite), bootstrapped with:
 *  1. A minimal stand-in for Supabase's `auth` schema — just enough for
 *     `auth.uid()` and the `auth.users` FK to resolve.
 *  2. The exact same SQL AgentTrust ships: every file under
 *     drizzle/migrations/ (schema) and
 *     supabase/migrations/0001_rls_and_triggers.sql (RLS + trigger).
 *  3. `anon`/`authenticated`/`service_role` roles, matching the ones a real
 *     Supabase project provisions — the RLS migration's own grants (run as
 *     part of it, below) then apply to these for real, rather than the
 *     harness hand-rolling a separate parallel set of grants.
 *
 * This exists so "RLS-sensitive access" tests exercise the real policies —
 * not a mock of them — without depending on a live Supabase project.
 */
export async function createTestDb() {
  const client = new PGlite();

  await client.exec(`
    create schema if not exists auth;
    create table if not exists auth.users (
      id uuid primary key,
      email text
    );
    create or replace function auth.uid() returns uuid
      language sql stable
      as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;

    do $$
    begin
      if not exists (select from pg_roles where rolname = 'authenticated') then
        create role authenticated;
      end if;
      if not exists (select from pg_roles where rolname = 'anon') then
        create role anon;
      end if;
      if not exists (select from pg_roles where rolname = 'service_role') then
        create role service_role;
      end if;
    end
    $$;
    alter role authenticated with nobypassrls;
    alter role anon with nobypassrls;
    -- Real Supabase's service_role bypasses RLS outright (it's the
    -- privileged role the admin/service client authenticates as) — matched
    -- here so the grants in the RLS migration below apply to a role with
    -- the same trust level, not a lower-privileged stand-in.
    alter role service_role with bypassrls;
  `);

  const migrationsDir = path.join(PROJECT_ROOT, "drizzle/migrations");
  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of migrationFiles) {
    await client.exec(fs.readFileSync(path.join(migrationsDir, file), "utf8"));
  }

  const rlsPath = path.join(
    PROJECT_ROOT,
    "supabase/migrations/0001_rls_and_triggers.sql",
  );
  await client.exec(fs.readFileSync(rlsPath, "utf8"));

  const db = drizzle(client, { schema }) as unknown as AppDatabase;
  return { client, db };
}

/** Inserts an auth.users row — the RLS/trigger migration's own trigger creates the matching profiles row. */
export async function seedUser(client: PGlite, id: string, email: string) {
  await client.query(`insert into auth.users (id, email) values ($1, $2)`, [
    id,
    email,
  ]);
}
