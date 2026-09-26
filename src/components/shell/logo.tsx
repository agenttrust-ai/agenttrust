import Link from "next/link";

/** The AgentTrust mark: a solid instrument tile with a verification tick. */
export function LogoMark({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" className={className}>
      <rect width="20" height="20" rx="5" className="fill-foreground" />
      <path
        d="M5.75 10.25l2.75 2.75 5.75-6.5"
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-background"
      />
    </svg>
  );
}

export function Logo() {
  return (
    <Link
      href="/"
      className="flex items-center gap-2 rounded-md font-semibold tracking-tight"
    >
      <LogoMark />
      <span>AgentTrust</span>
    </Link>
  );
}
