import { verifySession } from "@/lib/auth/dal";

/**
 * `proxy.ts` already redirects unauthenticated requests away from
 * `/dashboard/*` optimistically (cookie only, no DB round trip). This layout
 * is the real check: `verifySession()` verifies the session JWT itself and
 * redirects to /login if it's missing or invalid, so every route under
 * `/dashboard` is protected even if a proxy matcher is ever misconfigured.
 */
export default async function DashboardLayout({
  children,
}: LayoutProps<"/dashboard">) {
  await verifySession();

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">{children}</div>
  );
}
