/** "Sep 19, 2026" — the one date-only format used across the app. */
export function formatDate(value: Date | string | null | undefined, empty = "—"): string {
  if (!value) return empty;
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
