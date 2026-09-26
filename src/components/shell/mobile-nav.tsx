"use client";

import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { IconMenu, IconX } from "@/components/ui/icons";

/**
 * The small-screen navigation disclosure. Its contents are server-rendered
 * and passed in as children; this island only owns open/closed state. It
 * closes on navigation (state is keyed to the path it was opened on), on
 * Escape from anywhere on the page (returning focus to the toggle), and
 * when a link inside is used.
 */
export function MobileNav({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn !== null && openOn === pathname;
  const panelId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpenOn(null);
      toggleRef.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpenOn(open ? null : pathname)}
        className="-mr-2 inline-flex size-10 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground"
      >
        {open ? <IconX className="size-5" /> : <IconMenu className="size-5" />}
        <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
      </button>
      <div
        id={panelId}
        hidden={!open}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a")) setOpenOn(null);
        }}
        className="absolute inset-x-0 top-full border-b border-border bg-background px-4 pt-2 pb-4 shadow-overlay"
      >
        {children}
      </div>
    </div>
  );
}
