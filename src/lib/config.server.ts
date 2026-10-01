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
  // AES-256 key for encrypting monitored-endpoint credentials (bearer
  // tokens / API keys) at rest — see src/lib/security/agent-credentials.ts.
  // Deliberately a separate secret from API_KEY_HASH_PEPPER/CRON_SECRET:
  // this one must decode to real key bytes and be reversible, those are
  // one-way hashing/comparison secrets.
  AGENT_CREDENTIAL_ENCRYPTION_KEY: z
    .string()
    .length(64)
    .regex(/^[0-9a-f]+$/i, "must be 64 hex characters (32 bytes)"),
  // Optional key for check_agent_trust usage telemetry's keyed hashes (see
  // src/lib/telemetry/trust-check-events.ts, which reads it at call time and
  // ignores anything shorter than 32 characters). Never required: without it,
  // telemetry records events with no caller or endpoint hashes.
  TELEMETRY_HASH_KEY: z.string().optional(),
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
