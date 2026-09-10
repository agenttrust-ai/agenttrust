"use client";

import { useEffect } from "react";

export default function ApiKeysError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-10 text-center">
      <h2 className="text-lg font-semibold">
        Couldn&apos;t load your API keys
      </h2>
      <p className="max-w-sm text-sm text-muted">
        Something went wrong reaching the database. This is usually temporary.
      </p>
      <button
        onClick={() => retry()}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
      >
        Try again
      </button>
    </div>
  );
}
