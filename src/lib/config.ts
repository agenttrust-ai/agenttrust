import { z } from "zod";

/**
 * Client-safe configuration: only NEXT_PUBLIC_* variables. Safe to import
 * from Client Components. Server-only secrets live in `config.server.ts`,
 * which is guarded so it can never be bundled into client code.
 *
 * NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is Supabase's current key naming
 * (the successor to the legacy "anon key") — safe to ship to the browser
 * by design, same as its predecessor.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.url(),
});

function loadPublicEnv() {
  const parsed = publicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  });
  if (!parsed.success) {
    throw new Error(
      `Invalid public environment variables:\n${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}

export const publicEnv = loadPublicEnv();
