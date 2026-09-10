import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/config.server";
import * as schema from "./schema";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isLocalHost(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

// postgres.js defaults `ssl` to `false` unless the connection string's own
// `sslmode` query param says otherwise — Supabase's dashboard-copied
// strings include that param, but nothing here should *depend* on a query
// param nobody's re-checked surviving intact. Require SSL for anything
// that isn't plainly local; Supabase's pooled and direct endpoints both
// speak TLS and reject (or the network path simply drops) a plaintext
// attempt regardless.
const requiresSsl = !isLocalHost(env.DATABASE_URL);

// One pooled connection per server process, reused across requests —
// this is what `DATABASE_URL` (Supabase's pooler) is for. A short
// connect_timeout makes an unreachable database fail fast (as an ordinary
// rejected promise `runTransaction` in rls.ts normalizes) rather than
// hanging or retrying indefinitely.
const client = postgres(env.DATABASE_URL, {
  prepare: false,
  connect_timeout: 10,
  ssl: requiresSsl ? "require" : false,
});

export const db = drizzle(client, { schema });
