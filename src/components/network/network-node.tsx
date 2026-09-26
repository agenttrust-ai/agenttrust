import { cx } from "@/components/ui/cx";

/**
 * One point in AgentTrust's "observed agent network" motif — the small
 * node that stands for an agent endpoint AgentTrust knows about.
 *
 * Always decorative (`aria-hidden`): wherever a node carries a real
 * state, the same state is also on screen as text (a StatusPill, a count,
 * a label). A node never communicates anything on its own.
 */
export type NodeState =
  | "observed"
  | "healthy"
  | "degraded"
  | "down"
  | "unknown"
  | "draft"
  | "unresolved"
  | "signal";

const STATE_CLASS: Record<NodeState, string> = {
  observed: "bg-border-strong",
  healthy: "bg-positive",
  degraded: "bg-caution",
  down: "bg-negative",
  unknown: "border border-neutral bg-transparent",
  draft: "border border-border-strong bg-transparent",
  unresolved: "border border-dashed border-neutral bg-transparent",
  signal:
    "bg-accent shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_18%,transparent)]",
};

const SIZE_CLASS = {
  sm: "size-1.5",
  md: "size-2",
  lg: "size-3",
} as const;

export function NetworkNode({
  state,
  size = "md",
  pulse = false,
  className,
}: {
  state: NodeState;
  size?: keyof typeof SIZE_CLASS;
  /** A slow, low-contrast pulse — only with no reduced-motion preference. */
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-block shrink-0 rounded-full",
        SIZE_CLASS[size],
        STATE_CLASS[state],
        pulse && "at-node-pulse",
        className,
      )}
    />
  );
}

/**
 * Maps an agent's effective health (`getEffectiveAgentStatus`) and
 * lifecycle onto a node state. Drafts aren't monitored, so they're drawn
 * hollow rather than with any health color.
 */
export function nodeStateForAgent(status: string, isDraft = false): NodeState {
  if (isDraft) return "draft";
  switch (status) {
    case "healthy":
    case "degraded":
    case "down":
      return status;
    default:
      return "unknown";
  }
}
