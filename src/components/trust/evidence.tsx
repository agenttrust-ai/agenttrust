import { cx } from "@/components/ui/cx";
import {
  IconActivity,
  IconClock,
  IconGauge,
  IconShield,
  type IconComponent,
} from "@/components/ui/icons";

/**
 * The four kinds of evidence a trustDecision is computed from, with one
 * icon and name each. Every surface that talks about evidence — the Trust
 * Report, the homepage, agent pages — uses these, so the same signal
 * always looks the same.
 */
export type EvidenceKind = "health" | "reliability" | "freshness" | "ownership";

export const EVIDENCE: Record<EvidenceKind, { label: string; icon: IconComponent }> = {
  health: { label: "Health", icon: IconActivity },
  reliability: { label: "Reliability", icon: IconGauge },
  freshness: { label: "Evidence freshness", icon: IconClock },
  ownership: { label: "Endpoint ownership", icon: IconShield },
};

export const EVIDENCE_ORDER: EvidenceKind[] = ["health", "reliability", "freshness", "ownership"];

/** The evidence icon in its small instrument tile. Decorative — always sits beside the evidence's name. */
export function EvidenceGlyph({ kind, className }: { kind: EvidenceKind; className?: string }) {
  const Icon = EVIDENCE[kind].icon;
  return (
    <span
      aria-hidden="true"
      className={cx(
        "flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-muted",
        className,
      )}
    >
      <Icon className="size-3.5" />
    </span>
  );
}
