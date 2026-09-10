const SCORE_BANDS = [
  {
    min: 90,
    label: "Excellent",
    className:
      "bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-900",
  },
  {
    min: 75,
    label: "Good",
    className:
      "bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-900",
  },
  {
    min: 50,
    label: "Fair",
    className:
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900",
  },
  {
    min: 0,
    label: "Poor",
    className:
      "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-900",
  },
];

/**
 * `null` means "no score computed yet" (not enough monitoring history) —
 * rendered as a neutral placeholder, never as a 0 or any other number that
 * could read as an actual (and unjustifiably low or high) trust score.
 */
export function ReliabilityScoreBadge({ score }: { score: number | null }) {
  if (score === null) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs font-medium text-muted">
        Not enough data yet
      </span>
    );
  }

  const band = SCORE_BANDS.find((b) => score >= b.min) ?? SCORE_BANDS[SCORE_BANDS.length - 1];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${band.className}`}
    >
      {score.toFixed(0)}
      <span className="opacity-70">/100 · {band.label}</span>
    </span>
  );
}
