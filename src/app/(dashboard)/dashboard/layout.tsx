import { verifySession } from "@/lib/auth/dal";
import { DashboardNav } from "@/components/shell/dashboard-nav";

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
  const session = await verifySession();

  return (
    <div className="mx-auto w-full max-w-shell flex-1 px-4 py-6 sm:px-6 sm:py-8">
      <DashboardNav account={session.email ?? undefined} />
      <div className="mt-6 sm:mt-8">{children}</div>
    </div>
  );
}
