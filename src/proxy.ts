import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { publicEnv } from "@/lib/config";

const PROTECTED_PREFIXES = ["/dashboard"];
const AUTH_PAGES = ["/login", "/signup"];

/**
 * Runs on every request (see `config.matcher` below). Two jobs:
 *
 * 1. Refresh the Supabase session cookie so it never silently expires
 *    mid-visit — this has to happen before any Server Component reads it.
 * 2. An optimistic redirect for `/dashboard/*` and the auth pages. This is
 *    "optimistic" on purpose: it only reads the session cookie, no database
 *    call, so it can run on every request without adding real latency.
 *    It is not the security boundary — `verifySession()` in the DAL
 *    (src/lib/auth/dal.ts) is, and every dashboard page/action calls it too.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(data?.claims);
  const { pathname } = request.nextUrl;

  if (
    PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix)) &&
    !isAuthenticated
  ) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (AUTH_PAGES.includes(pathname) && isAuthenticated) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Run on everything except static assets, image optimization files, API
     * routes, and static discovery files (robots.txt, sitemap.xml,
     * .well-known/*, llms.txt).
     *
     * API routes (/api/*, including /api/mcp) never use this Supabase
     * cookie session at all — they authenticate with a Bearer API key
     * checked in-route (see src/lib/api/authenticate.ts and
     * withMcpAuth/verifyToken in src/app/api/mcp/route.ts), and they render
     * no UI that depends on knowing whether a browser session is logged in.
     * Running getClaims() for them was pure overhead on every request,
     * including the anonymous, rate-limited check_agent_trust MCP calls
     * this project explicitly wants to be cheap to call. Static discovery
     * files are plain files/metadata routes with no session-dependent
     * rendering either.
     *
     * Every real page under RootLayout (/, /docs, /check-agent-trust,
     * /login, /signup, /dashboard/*) stays matched, so the session-refresh
     * behavior described above and AuthNav's login state keep working
     * exactly as before.
     */
    "/((?!_next/static|_next/image|favicon.ico|api/|\\.well-known/|robots\\.txt$|sitemap\\.xml$|llms\\.txt$|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
