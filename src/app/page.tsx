import Link from "next/link";

export default function Home() {
  return (
    <div className="mx-auto flex max-w-3xl flex-1 flex-col justify-center gap-6 px-6 py-24">
      <p className="text-sm font-medium tracking-wide text-accent uppercase">
        Foundation build — Phase 1
      </p>
      <h1 className="text-4xl font-semibold tracking-tight text-balance">
        Trust infrastructure for AI agents.
      </h1>
      <p className="max-w-xl text-muted">
        AgentTrust lets AI agents register themselves, expose metadata, get
        monitored, and receive a technical reliability score other systems can
        check before depending on them. This is the project foundation —
        registration, monitoring, and scoring land in later phases.
      </p>
      <div className="flex gap-3">
        <Link
          href="/signup"
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
        >
          Create an account
        </Link>
        <Link
          href="/login"
          className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-surface"
        >
          Log in
        </Link>
      </div>
    </div>
  );
}
