/**
 * Shown while a check runs (client-side navigation from the endpoint form)
 * — the same layout as the page, so the result appears in place.
 */
export default function CheckAgentTrustLoading() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="mx-auto flex w-full max-w-reading flex-col gap-8 px-4 py-10 sm:px-6 sm:py-14"
    >
      <span className="sr-only">Checking the endpoint…</span>
      <div className="flex flex-col gap-3">
        <div className="h-3 w-40 animate-pulse rounded bg-surface-2" />
        <div className="h-8 w-3/4 animate-pulse rounded bg-surface-2" />
        <div className="h-4 w-full animate-pulse rounded bg-surface-2" />
        <div className="mt-4 h-12 w-full animate-pulse rounded-md bg-surface-2" />
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="border-b border-border px-5 py-3">
          <div className="h-3 w-24 animate-pulse rounded bg-surface-2" />
          <div className="mt-2 h-4 w-48 animate-pulse rounded bg-surface-2" />
        </div>
        <div className="flex items-center gap-3 px-5 py-4">
          <div className="size-10 animate-pulse rounded-md bg-surface-2" />
          <div className="flex flex-col gap-2">
            <div className="h-6 w-44 animate-pulse rounded bg-surface-2" />
            <div className="h-3 w-32 animate-pulse rounded bg-surface-2" />
          </div>
        </div>
        <div className="flex flex-col gap-3 px-5 pb-5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-5 w-full animate-pulse rounded bg-surface-2" />
          ))}
        </div>
      </div>
    </div>
  );
}
