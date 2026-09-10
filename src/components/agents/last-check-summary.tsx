type CheckLike =
  | {
      checkedAt: Date | string;
      latencyMs: number | null;
      statusCode: number | null;
    }
  | undefined;

function formatRelativeTime(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/** One consistent renderer for a single field of "the most recent check", used across the list, detail, and history views. */
export function LastCheckSummary({
  check,
  field,
}: {
  check: CheckLike;
  field: "checkedAt" | "latency" | "httpStatus";
}) {
  if (!check) return <span className="text-muted">—</span>;

  if (field === "checkedAt") {
    return <span>{formatRelativeTime(check.checkedAt)}</span>;
  }
  if (field === "latency") {
    return (
      <span>{check.latencyMs != null ? `${check.latencyMs} ms` : "—"}</span>
    );
  }
  return <span>{check.statusCode ?? "—"}</span>;
}
