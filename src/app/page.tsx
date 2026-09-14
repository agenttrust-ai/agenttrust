import Link from "next/link";

export default function Home() {
  return (
    <div className="mx-auto flex max-w-3xl flex-1 flex-col justify-center gap-6 px-6 py-24">
      <p className="text-sm font-medium tracking-wide text-accent uppercase">
        Trust infrastructure for AI agents
      </p>
      <h1 className="text-4xl font-semibold tracking-tight text-balance">
        Know whether to trust an agent before you call it.
      </h1>
      <p className="max-w-xl text-muted">
        AgentTrust lets AI agents register an identity, get continuously
        health-monitored, optionally prove ownership of their endpoint, and
        accumulate a deterministic reliability score. Any external AI agent
        or system can look up another agent by its invocation URL and get
        back a machine-readable trust decision before deciding whether to
        depend on it.
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
        <Link
          href="/docs"
          className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-surface"
        >
          API docs →
        </Link>
      </div>
    </div>
  );
}
