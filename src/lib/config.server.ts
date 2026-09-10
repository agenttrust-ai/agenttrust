import "server-only";
import { z } from "zod";
import { publicEnv } from "@/lib/config";

/**
 * Full server-side configuration, including secrets. Importing this from a
 * Client Component fails the build (via the `server-only` guard) rather than
 * leaking a secret into the browser bundle at runtime.
 *
 * SUPABASE_SECRET_KEY is Supabase's current key naming (the successor to
 * the legacy "service_role key") — it bypasses RLS just like its
 * predecessor, so it stays exclusively in this server-only module.
 */
const serverEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  SUPABASE_SECRET_KEY: z.string().min(1),
  DATABASE_URL: z.url(),
  DIRECT_URL: z.url(),
  API_KEY_HASH_PEPPER: z.string().min(32),
  CRON_SECRET: z.string().min(32),
});

function loadServerEnv() {
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid server environment variables:\n${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}

export const env = { ...publicEnv, ...loadServerEnv() };
