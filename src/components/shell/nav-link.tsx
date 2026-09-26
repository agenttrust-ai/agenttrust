"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { isNavActive } from "./nav-active";

/**
 * A `Link` that marks itself `aria-current="page"` on its own route. Only
 * the current-page state needs the client; styling reacts to the
 * attribute (`aria-[current=page]:…`).
 */
export function NavLink({
  href,
  exact,
  className,
  children,
}: {
  href: string;
  exact?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const active = isNavActive(pathname, href, { exact });
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={className}
    >
      {children}
    </Link>
  );
}
