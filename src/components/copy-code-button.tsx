"use client";

import { useState } from "react";

/**
 * The only client-side JS on any page that renders it — everything else
 * about a code example stays server-rendered. Isolated here on purpose so
 * a docs/marketing page importing it never itself becomes a Client
 * Component.
 */
export function CopyCodeButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — fail silently,
      // the code is still selectable/copyable by hand.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label="Copy code to clipboard"
      className="absolute top-2 right-2 rounded border border-border bg-surface px-2 py-1 text-xs font-medium text-muted hover:bg-surface-2 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
