import type { ReactNode } from "react";
import { IconDashedCircle, type IconComponent } from "./icons";

/** A neutral, dashed "nothing here yet" panel with an optional next action. */
export function EmptyState({
  icon: Icon = IconDashedCircle,
  title,
  children,
  action,
}: {
  icon?: IconComponent;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border-strong px-6 py-10 text-center">
      <Icon className="size-5 text-subtle" />
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="max-w-sm text-sm text-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
