import { NavLink } from "./nav-link";

export const DASHBOARD_NAV = [
  { href: "/dashboard", label: "Overview", exact: true },
  { href: "/dashboard/agents", label: "Agents", exact: false },
  { href: "/dashboard/api-keys", label: "API keys", exact: false },
] as const;

/** Current tab: foreground text + a neutral underline — blue stays reserved for actions and focus. */
const TAB =
  "relative inline-flex h-10 shrink-0 items-center px-1 text-sm text-muted transition-[color,background-color] duration-150 " +
  "hover:text-foreground aria-[current=page]:text-foreground aria-[current=page]:font-medium " +
  "after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent " +
  "aria-[current=page]:after:bg-foreground";

/**
 * Section navigation shared by every /dashboard page. The signed-in
 * account is shown here as quiet context rather than as page content.
 */
export function DashboardNav({ account }: { account?: string }) {
  return (
    <div className="flex items-end justify-between gap-6 border-b border-border">
      <nav aria-label="Dashboard" className="-mx-4 -mb-px min-w-0 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex gap-6">
          {DASHBOARD_NAV.map((item) => (
            <NavLink key={item.href} href={item.href} exact={item.exact} className={TAB}>
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
      {account && (
        <p className="hidden min-w-0 truncate pb-2.5 text-xs text-muted sm:block">
          Signed in as <span className="text-foreground">{account}</span>
        </p>
      )}
    </div>
  );
}
