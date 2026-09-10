const STATUS_LABEL: Record<string, string> = {
  unknown: "Not yet monitored",
  healthy: "Healthy",
  degraded: "Degraded",
  down: "Down",
};

const STATUS_CLASS: Record<string, string> = {
  unknown: "bg-surface text-muted border-border",
  healthy:
    "bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-900",
  degraded:
    "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900",
  down: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-900",
};

/**
 * A neutral "not yet monitored" placeholder is the only status that
 * currently reflects reality — health checks haven't shipped yet (Phase 3).
 * The other variants exist so this component doesn't need to change once
 * they do.
 */
export function StatusPill({ status }: { status: string }) {
  const label = STATUS_LABEL[status] ?? status;
  const className = STATUS_CLASS[status] ?? STATUS_CLASS.unknown;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${className}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {label}
    </span>
  );
}
