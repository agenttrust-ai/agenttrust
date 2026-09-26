export default function AgentsLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <span className="sr-only">Loading your agents…</span>
      <div className="flex items-end justify-between gap-6">
        <div className="flex flex-col gap-2">
          <div className="h-3 w-20 animate-pulse rounded bg-surface-2" />
          <div className="h-7 w-28 animate-pulse rounded bg-surface-2" />
          <div className="h-4 w-72 animate-pulse rounded bg-surface-2" />
        </div>
        <div className="h-8 w-32 animate-pulse rounded-md bg-surface-2" />
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="h-9 border-b border-border bg-surface-2" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-6 border-b border-border px-4 py-3.5 last:border-0">
            <div className="flex w-48 flex-col gap-1.5">
              <div className="h-4 w-32 animate-pulse rounded bg-surface-2" />
              <div className="h-3 w-24 animate-pulse rounded bg-surface-2" />
            </div>
            <div className="h-6 w-20 animate-pulse rounded-full bg-surface-2" />
            <div className="h-6 w-28 animate-pulse rounded-full bg-surface-2" />
            <div className="h-6 w-24 animate-pulse rounded-full bg-surface-2" />
            <div className="h-4 flex-1 animate-pulse rounded bg-surface-2" />
          </div>
        ))}
      </div>
    </div>
  );
}
