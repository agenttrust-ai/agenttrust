import Link from "next/link";
import type { Metadata } from "next";
import { publicEnv } from "@/lib/config";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

/**
 * Minimal SoftwareApplication structured data for the homepage — describes
 * AgentTrust itself as a product, not any individual monitored agent (that
 * data has its own, separate JSON-LD-adjacent surface: the A2A Agent Card
 * at /.well-known/agent-card.json). No pricing/offers claim included —
 * there is no paid tier to describe, and inventing one would be exactly
 * the kind of unsupported claim this content must avoid.
 */
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "AgentTrust",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Any",
  description:
    "AgentTrust is trust infrastructure for AI agents. It helps an AI check another agent or endpoint before invocation using reliability monitoring, endpoint ownership verification, reputation/trust signals, and a machine-readable trustDecision.",
  url: publicEnv.NEXT_PUBLIC_APP_URL,
  sameAs: ["https://github.com/agenttrust-ai/agenttrust"],
};

export default function Home() {
  return (
    <div className="mx-auto flex max-w-3xl flex-1 flex-col justify-center gap-6 px-6 py-24">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(STRUCTURED_DATA).replace(/</g, "\\u003c"),
        }}
      />
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
      <p className="max-w-xl text-muted">
        Already building an agent? Call the <code>check_agent_trust</code>{" "}
        tool on AgentTrust&apos;s MCP server with an endpoint URL — no
        AgentTrust account or API key required. It checks AgentTrust&apos;s
        existing monitoring data and never contacts the target endpoint
        directly. See{" "}
        <Link href="/docs" className="text-accent hover:underline">
          the docs
        </Link>{" "}
        for details.
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
