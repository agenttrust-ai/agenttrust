"use client";

import { useState } from "react";
import { cx } from "@/components/ui/cx";
import { IconCheck, IconCopy } from "@/components/ui/icons";

/**
 * The only client-side JS a code example needs — the surrounding
 * `CodeBlock` stays server-rendered. Shows and announces "Copied" so the
 * result is visible and reaches screen readers.
 */
export function CopyButton({
  text,
  label = "Copy code to clipboard",
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — the code is
      // still selectable and copyable by hand.
    }
  }

  return (
    <span className={className}>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={label}
        className={cx(
          "inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-2 text-xs font-medium text-muted",
          "transition-[color,background-color] duration-150 hover:bg-surface-2 hover:text-foreground active:translate-y-px",
          copied && "text-positive",
        )}
      >
        {copied ? (
          <IconCheck className="size-3.5" />
        ) : (
          <IconCopy className="size-3.5" />
        )}
        {copied ? "Copied" : "Copy"}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </span>
  );
}
