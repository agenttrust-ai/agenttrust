import { Suspense } from "react";
import { AuthNav, AuthNavPlaceholder } from "@/components/auth-nav";
import { Logo } from "./logo";
import { MobileNav } from "./mobile-nav";
import { NavLink } from "./nav-link";

/** Primary product navigation — existing routes and anchors only. */
export const PRIMARY_NAV = [
  { href: "/check-agent-trust", label: "Check an agent" },
  { href: "/docs", label: "Docs" },
  { href: "/docs#mcp", label: "MCP" },
] as const;

const BAR_LINK =
  "inline-flex h-8 items-center rounded-md px-2.5 text-sm text-muted transition-[color,background-color] duration-150 " +
  "hover:bg-surface-2 hover:text-foreground aria-[current=page]:text-foreground aria-[current=page]:bg-surface-2";

const MENU_LINK =
  "flex h-11 items-center rounded-md px-3 text-sm text-foreground hover:bg-surface-2 " +
  "aria-[current=page]:bg-surface-2 aria-[current=page]:font-medium";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      <div className="mx-auto flex h-14 w-full max-w-shell items-center gap-6 px-4 sm:px-6">
        <Logo />

        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {PRIMARY_NAV.map((item) => (
            <NavLink key={item.href} href={item.href} className={BAR_LINK}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-1 md:flex">
          <Suspense fallback={<AuthNavPlaceholder />}>
            <AuthNav />
          </Suspense>
        </div>

        <div className="ml-auto md:hidden">
          <MobileNav>
            <nav aria-label="Primary" className="flex flex-col">
              {PRIMARY_NAV.map((item) => (
                <NavLink key={item.href} href={item.href} className={MENU_LINK}>
                  {item.label}
                </NavLink>
              ))}
            </nav>
            <div className="mt-2 flex flex-col border-t border-border pt-2">
              <Suspense fallback={null}>
                <AuthNav variant="menu" />
              </Suspense>
            </div>
          </MobileNav>
        </div>
      </div>
    </header>
  );
}
