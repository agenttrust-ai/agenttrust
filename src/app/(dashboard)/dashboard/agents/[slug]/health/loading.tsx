export default function HealthHistoryLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="h-4 w-24 animate-pulse rounded bg-surface-2" />
        <div className="h-7 w-48 animate-pulse rounded bg-surface-2" />
        <div className="h-4 w-32 animate-pulse rounded bg-surface-2" />
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b border-border px-4 py-4 last:border-0"
          >
            <div className="h-4 w-36 animate-pulse rounded bg-surface-2" />
            <div className="h-5 w-20 animate-pulse rounded-full bg-surface-2" />
            <div className="h-4 w-16 animate-pulse rounded bg-surface-2" />
            <div className="h-4 flex-1 animate-pulse rounded bg-surface-2" />
          </div>
        ))}
      </div>
    </div>
  );
}
