import Link from "next/link";
import { getOptionalSession } from "@/lib/auth/dal";
import { logout } from "@/lib/auth/actions";
import { buttonClass } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { NavLink } from "@/components/shell/nav-link";

/** Current-page styling for the Dashboard link (set via `aria-current` by NavLink). */
const CURRENT_BAR = "aria-[current=page]:bg-surface-2 aria-[current=page]:text-foreground";
const CURRENT_MENU = "aria-[current=page]:bg-surface-2 aria-[current=page]:font-medium";

/**
 * Split out from the root layout so the session check (`await` on cookies)
 * doesn't hold up the first streamed byte of every page — see Next.js's
 * "Auth and streaming" guidance. Wrap this in <Suspense> where it's used.
 *
 * `variant="menu"` renders the same links full-width for the mobile menu.
 */
export async function AuthNav({ variant = "bar" }: { variant?: "bar" | "menu" }) {
  const session = await getOptionalSession();
  const menu = variant === "menu";
  const itemClass = menu
    ? "flex h-11 w-full items-center rounded-md px-3 text-sm text-foreground hover:bg-surface-2"
    : buttonClass({ variant: "ghost", size: "sm" });

  if (!session) {
    return (
      <>
        <Link href="/login" className={itemClass}>
          Log in
        </Link>
        <Link
          href="/signup"
          className={buttonClass({
            variant: "primary",
            size: menu ? "lg" : "sm",
            className: menu ? "mt-2 w-full" : undefined,
          })}
        >
          Sign up
        </Link>
      </>
    );
  }

  return (
    <>
      {/* Not `exact`: stays current on every nested /dashboard/* route. */}
      <NavLink
        href="/dashboard"
        className={cx(itemClass, menu ? CURRENT_MENU : CURRENT_BAR)}
      >
        Dashboard
      </NavLink>
      <form action={logout} className={menu ? "w-full" : undefined}>
        <button type="submit" className={cx(itemClass, "cursor-pointer")}>
          Log out
        </button>
      </form>
    </>
  );
}

/**
 * Reserves the signed-out auth area's width while the session streams in,
 * so the header doesn't shift when it resolves.
 */
export function AuthNavPlaceholder() {
  return <span aria-hidden="true" className="inline-block h-8 w-[8.75rem]" />;
}
