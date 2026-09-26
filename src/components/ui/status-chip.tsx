import type { ReactNode } from "react";
import { cx } from "./cx";
import {
  IconAlert,
  IconCheck,
  IconDashedCircle,
  IconInfo,
  IconX,
  type IconComponent,
} from "./icons";

export type StatusTone = "positive" | "negative" | "caution" | "neutral" | "info";

const TONE_CLASS: Record<StatusTone, string> = {
  positive: "border-positive-border bg-positive-surface text-positive",
  negative: "border-negative-border bg-negative-surface text-negative",
  caution: "border-caution-border bg-caution-surface text-caution",
  neutral: "border-neutral-border bg-neutral-surface text-neutral",
  info: "border-info-border bg-info-surface text-info",
};

/** Each tone has its own shape, so meaning never depends on color alone. */
const TONE_ICON: Record<StatusTone, IconComponent> = {
  positive: IconCheck,
  negative: IconX,
  caution: IconAlert,
  neutral: IconDashedCircle,
  info: IconInfo,
};

/**
 * The one compact status primitive: tone color + icon + text label. Pages
 * map their own domain values (health status, check result, score band…)
 * onto a tone — this component knows nothing about trust semantics.
 */
export function StatusChip({
  tone,
  icon,
  title,
  className,
  children,
}: {
  tone: StatusTone;
  /** Overrides the tone's default icon. */
  icon?: IconComponent;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  const Icon = icon ?? TONE_ICON[tone];
  return (
    <span
      title={title}
      data-tone={tone}
      className={cx(
        "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs font-medium whitespace-nowrap",
        TONE_CLASS[tone],
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      {children}
    </span>
  );
}
