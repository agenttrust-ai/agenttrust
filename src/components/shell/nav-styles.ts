/**
 * Navigation link styling, shared by the header bar, the signed-in
 * Dashboard link and the mobile menu.
 *
 * The current page is marked by stronger text plus a neutral underline
 * (bar) or a subtle background (menu) — never the blue accent, which is
 * reserved for real actions ("Check agent") and the keyboard focus ring.
 * So "current page" (underline) and "keyboard focus" (blue outline) stay
 * visually distinct, and neither relies on color alone.
 */
export const NAV_BAR_LINK =
  "relative inline-flex h-8 items-center rounded-md px-2.5 text-sm text-muted " +
  "transition-[color,background-color] duration-150 hover:bg-surface-2 hover:text-foreground " +
  "aria-[current=page]:font-medium aria-[current=page]:text-foreground " +
  // Underline sits on the header's bottom border (h-14 bar, h-8 link).
  "after:absolute after:inset-x-2.5 after:-bottom-[13px] after:h-0.5 after:rounded-full " +
  "after:bg-transparent aria-[current=page]:after:bg-foreground";

export const NAV_MENU_LINK =
  "flex h-11 w-full items-center rounded-md px-3 text-sm text-foreground hover:bg-surface-2 " +
  "aria-[current=page]:bg-surface-2 aria-[current=page]:font-medium";
