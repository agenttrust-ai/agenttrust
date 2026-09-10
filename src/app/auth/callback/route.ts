import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Destination for Supabase's email-confirmation and OAuth redirects. Exchanges
 * the one-time `code` for a session, then sends the user on to the dashboard.
 */
/**
 * Only a same-origin relative path is a valid redirect target — `next`
 * arrives as an unauthenticated query parameter, so treat it as untrusted.
 * Rejects anything that could act as an absolute or protocol-relative URL
 * (open-redirect territory: "https://evil.com", "//evil.com", "/\evil.com").
 */
function safeNextPath(next: string | null): string {
  if (
    !next ||
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.includes("\\")
  ) {
    return "/dashboard";
  }
  return next;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(
    `${origin}/login?error=Could not verify your sign-in link.`,
  );
}
