import {
  SCORE_THRESHOLD_HIGH_CONFIDENCE,
  SCORE_THRESHOLD_RECOMMENDED,
} from "@/lib/reliability/scoring";
import type { ReliabilityScoreStatus } from "@/lib/reliability/freshness";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { IconClock } from "@/components/ui/icons";

/**
 * Score bands follow the backend's own thresholds and nothing else:
 * `SCORE_THRESHOLD_RECOMMENDED` (the minimum score `recommended` can use)
 * and `SCORE_THRESHOLD_HIGH_CONFIDENCE` (the score `confidence: "high"`
 * needs). There is deliberately no band boundary the backend doesn't have.
 */
const SCORE_BANDS: { min: number; label: string; tone: StatusTone }[] = [
  { min: SCORE_THRESHOLD_HIGH_CONFIDENCE, label: "Excellent", tone: "positive" },
  { min: SCORE_THRESHOLD_RECOMMENDED, label: "Good", tone: "positive" },
  { min: 0, label: "Poor", tone: "negative" },
];

/**
 * `null` means "no score computed yet" (not enough monitoring history) —
 * rendered as a neutral placeholder, never as a 0 or any other number that
 * could read as an actual (and unjustifiably low or high) trust score.
 *
 * A `stale` score (see src/lib/reliability/freshness.ts) is shown with its
 * historical value but neutral and clearly labeled "out of date" — never
 * with a positive/negative band, which would present it as a current
 * verdict.
 */
export function ReliabilityScoreBadge({
  score,
  status,
}: {
  score: number | null;
  status?: ReliabilityScoreStatus;
}) {
  if (score !== null && status === "stale") {
    return (
      <StatusChip
        tone="neutral"
        icon={IconClock}
        title="Not enough recent health checks to count this as current evidence."
      >
        Out of date
        <span className="font-mono tabular-nums opacity-75">
          · last {score.toFixed(0)}/100
        </span>
      </StatusChip>
    );
  }

  if (score === null) {
    return <StatusChip tone="neutral">Not enough data yet</StatusChip>;
  }

  const band =
    SCORE_BANDS.find((b) => score >= b.min) ?? SCORE_BANDS[SCORE_BANDS.length - 1];

  return (
    <StatusChip tone={band.tone}>
      <span className="font-mono tabular-nums">{score.toFixed(0)}</span>
      <span className="opacity-75">/100 · {band.label}</span>
    </StatusChip>
  );
}
