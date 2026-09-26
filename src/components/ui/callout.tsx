import type { ReactNode } from "react";
import { cx } from "./cx";
import { IconAlert, IconInfo, type IconComponent } from "./icons";

type CalloutTone = "info" | "neutral" | "caution";

const TONE: Record<CalloutTone, { box: string; icon: string; Icon: IconComponent }> = {
  info: { box: "border-info-border bg-info-surface", icon: "text-info", Icon: IconInfo },
  neutral: { box: "border-border bg-surface", icon: "text-muted", Icon: IconInfo },
  caution: { box: "border-caution-border bg-caution-surface", icon: "text-caution", Icon: IconAlert },
};

/**
 * A short highlighted note inside content (docs, explanations). Body text
 * stays in the regular foreground color for readability; only the icon
 * carries the tone.
 */
export function Callout({
  tone = "neutral",
  title,
  icon,
  children,
  role,
  className,
}: {
  tone?: CalloutTone;
  title?: ReactNode;
  icon?: IconComponent;
  children: ReactNode;
  /** e.g. "status" or "alert" when the callout reports a result. */
  role?: "status" | "alert";
  className?: string;
}) {
  const t = TONE[tone];
  const Icon = icon ?? t.Icon;
  return (
    <div role={role} className={cx("flex gap-3 rounded-md border px-4 py-3 text-sm", t.box, className)}>
      <Icon className={cx("mt-0.5 size-4 shrink-0", t.icon)} />
      <div className="min-w-0 text-foreground">
        {title && <p className="font-medium">{title}</p>}
        <div className={cx(title ? "mt-1" : undefined, "text-muted [&_strong]:text-foreground")}>{children}</div>
      </div>
    </div>
  );
}

