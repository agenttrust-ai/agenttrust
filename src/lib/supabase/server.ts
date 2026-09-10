import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/config";

/**
 * Supabase client for Server Components, Server Actions, and Route Handlers.
 * Must be created fresh per request (never module-level singleton) — it
 * closes over this request's cookie jar, and a shared instance would leak
 * one user's session into another's request.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component that can't write cookies (no
            // response to attach them to). Proxy already refreshes the
            // session on every request, so this is safe to ignore here.
          }
        },
      },
    },
  );
}
