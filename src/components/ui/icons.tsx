import type { ReactNode, SVGProps } from "react";

/**
 * A small, dependency-free inline icon set (16×16 grid, 1.5px stroke,
 * `currentColor`). Decorative by default (`aria-hidden`) — every status
 * icon in the UI sits next to a text label that carries the meaning.
 */
export type IconProps = Omit<SVGProps<SVGSVGElement>, "children">;
export type IconComponent = (props: IconProps) => ReactNode;

function Icon({
  children,
  className,
  ...props
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className ?? "size-4 shrink-0"}
      {...props}
    >
      {children}
    </svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 8.5l3 3 6-7" />
    </Icon>
  );
}

export function IconX(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
    </Icon>
  );
}

/** Warning triangle — degraded / caution. */
export function IconAlert(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 2.25l6 11H2z" />
      <path d="M8 6.5v3M8 11.6v.01" />
    </Icon>
  );
}

/** Dashed ring — unknown / not enough evidence yet. */
export function IconDashedCircle(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="5.5" strokeDasharray="2.2 2.2" />
    </Icon>
  );
}

export function IconInfo(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 7.25v3.5M8 5.4v.01" />
    </Icon>
  );
}

/** Clock — time-based states such as out-of-date evidence. */
export function IconClock(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 5v3.25l2 1.25" />
    </Icon>
  );
}

/** Shield — endpoint ownership not (yet) verified. */
export function IconShield(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 1.75l5 1.9v3.9c0 3.05-2.05 5.35-5 6.7-2.95-1.35-5-3.65-5-6.7v-3.9z" />
    </Icon>
  );
}

/** Shield with tick — endpoint ownership verified. */
export function IconShieldCheck(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 1.75l5 1.9v3.9c0 3.05-2.05 5.35-5 6.7-2.95-1.35-5-3.65-5-6.7v-3.9z" />
      <path d="M5.75 8.1l1.6 1.6 3-3.3" />
    </Icon>
  );
}

/** Pulse line — health checks. */
export function IconActivity(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M1.75 8h2.5l1.75-4.5 3.5 9 1.75-4.5h2.5" />
    </Icon>
  );
}

/** Gauge — reliability score. */
export function IconGauge(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.75 11.5a5.25 5.25 0 1 1 10.5 0" />
      <path d="M8 11.5l2.5-3.5" />
    </Icon>
  );
}

export function IconCopy(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" />
    </Icon>
  );
}

export function IconMenu(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
    </Icon>
  );
}

export function IconArrowRight(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 8h10M9 4l4 4-4 4" />
    </Icon>
  );
}

export function IconExternal(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9.5 2.5h4v4M13.5 2.5l-6 6" />
      <path d="M12 9.5V13a.5.5 0 0 1-.5.5h-8A.5.5 0 0 1 3 13V5a.5.5 0 0 1 .5-.5H7" />
    </Icon>
  );
}
