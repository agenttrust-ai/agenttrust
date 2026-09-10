import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Session = { userId: string; email: string | null };

/**
 * The one place a request verifies who's calling. `getClaims()` verifies the
 * session JWT's signature locally (no round trip to the Auth server unless
 * the token needs refreshing), which is what Supabase recommends over the
 * older `getSession()` (reads an unverified cookie) for anything
 * security-sensitive. Wrapped in React's `cache()` so multiple calls during
 * one render pass only verify once.
 */
export const verifySession = cache(async (): Promise<Session> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    redirect("/login");
  }

  return { userId: data.claims.sub, email: data.claims.email ?? null };
});

/** Same check, without redirecting — for optional/optimistic use (e.g. nav UI). */
export const getOptionalSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) return null;
  return { userId: data.claims.sub, email: data.claims.email ?? null };
});
