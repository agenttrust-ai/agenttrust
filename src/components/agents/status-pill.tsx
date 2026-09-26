import { StatusChip, type StatusTone } from "@/components/ui/status-chip";

const STATUS_LABEL: Record<string, string> = {
  unknown: "Not yet monitored",
  healthy: "Healthy",
  degraded: "Degraded",
  down: "Down",
};

const STATUS_TONE: Record<string, StatusTone> = {
  unknown: "neutral",
  healthy: "positive",
  degraded: "caution",
  down: "negative",
};

/**
 * An agent's health status (`getEffectiveAgentStatus`) as icon + label:
 * healthy ✓, degraded ⚠, down ✕, and a neutral dashed ring for an agent
 * with no monitoring result yet. Unrecognised values render as-is, neutral.
 */
export function StatusPill({ status }: { status: string }) {
  return (
    <StatusChip tone={STATUS_TONE[status] ?? "neutral"}>
      {STATUS_LABEL[status] ?? status}
    </StatusChip>
  );
}
