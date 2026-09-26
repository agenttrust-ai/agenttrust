import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The one page-title block used across the app: optional back link and
 * eyebrow, the page's single h1, a short description, and right-aligned
 * actions that wrap below the title on narrow screens instead of
 * squeezing it.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  back,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        {back && (
          <Link
            href={back.href}
            className="mb-2 inline-flex items-center gap-1 rounded-sm text-sm text-muted hover:text-foreground"
          >
            <span aria-hidden="true">←</span> {back.label}
          </Link>
        )}
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="mt-1 text-title break-words">{title}</h1>
        {description && <div className="mt-1.5 max-w-2xl text-sm text-muted">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
