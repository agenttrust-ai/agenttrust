import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/config";

/** Supabase client for Client Components. Safe to call from the browser. */
export function createClient() {
  return createBrowserClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
