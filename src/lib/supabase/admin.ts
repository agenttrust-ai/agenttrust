import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/config.server";

/**
 * Service-role Supabase client — bypasses Row Level Security entirely.
 * Reserved for trusted server-side contexts with no request-scoped user:
 * cron jobs, internal routes, and the profile-bootstrap trigger's supporting
 * code. Never import this into anything reachable from a user request
 * without an explicit authorization check first.
 */
export function createAdminClient() {
  return createSupabaseClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SECRET_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
