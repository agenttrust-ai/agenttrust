import Link from "next/link";
import type { Metadata } from "next";
import { publicEnv } from "@/lib/config";
import { TrustDecisionSummary } from "@/components/agents/trust-decision-summary";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

/**
 * Minimal SoftwareApplication structured data for the homepage — describes
 * AgentTrust itself as a product, not any individual monitored agent (that
 * data has its own, separate JSON-LD-adjacent surface: the A2A Agent Card
 * at /.well-known/agent-card.json). No pricing/offers claim included —
 * there is no paid tier to describe, and inventing one would be exactly
 * the kind of unsupported claim this content must avoid. Deliberately
 * doesn't mention "reputation" — AgentTrust has no community-rating or
 * review functionality, only monitoring/verification-derived signals.
 */
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "AgentTrust",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Any",
  description:
    "AgentTrust is trust infrastructure for AI agents. It helps an AI check another agent or endpoint before invocation using reliability monitoring, endpoint ownership verification, and a machine-readable trustDecision.",
  url: publicEnv.NEXT_PUBLIC_APP_URL,
  sameAs: ["https://github.com/agenttrust-ai/agenttrust"],
};

const EXAMPLE_RESULT = {
  matched: true,
  slug: "example-agent",
  name: "Example Agent",
  status: "healthy",
  verified: true,
  reliabilityScore: 92,
  trustDecision: {
    recommended: true,
    confidence: "high" as const,
    reasons: [],
  },
};

function Code({ children }: { children: string }) {
  return (
    <pre className="mt-2 overflow-x-auto rounded-md border border-border bg-background p-3 font-mono text-xs">
      <code>{children}</code>
    </pre>
  );
}

export default function Home() {
  return (
    <div className="flex flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(STRUCTURED_DATA).replace(/</g, "\\u003c"),
        }}
      />

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 pt-16 pb-12">
        <div>
          <p className="text-sm font-medium tracking-wide text-accent uppercase">
            Trust infrastructure for AI agents
          </p>
          <h1 className="mt-1 text-4xl font-semibold tracking-tight text-balance">
            Know whether to trust an AI agent before you call it.
          </h1>
          <p className="mt-4 max-w-xl text-muted">
            Enter an agent&apos;s exact endpoint URL. AgentTrust looks up its
            existing monitoring history, endpoint ownership verification, and
            reliability evidence, then returns a machine-readable
            trustDecision — without contacting that endpoint during the
            check. No AgentTrust account or API key required.
          </p>
        </div>

        <form
          action="/check-agent-trust"
          method="GET"
          className="flex flex-col gap-2 sm:flex-row"
        >
          <label htmlFor="home-endpoint-url" className="sr-only">
            Agent endpoint URL
          </label>
          <input
            id="home-endpoint-url"
            name="endpointUrl"
            type="url"
            required
            maxLength={2048}
            placeholder="https://your-agent.example.com/invoke"
            className="flex-1 rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-accent"
          />
          <button
            type="submit"
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
          >
            Check trust →
          </button>
        </form>
        <p className="text-xs text-muted">
          Read-only · No API key required · Target endpoint is never
          contacted during the check
        </p>
      </div>

      <div className="border-t border-border">
        <div className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-4 px-6 py-10 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-surface p-4">
            <p className="text-xs font-medium tracking-wide text-accent uppercase">
              1. Discover
            </p>
            <p className="mt-1 text-sm text-muted">
              An agent has an endpoint URL it&apos;s about to call.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-surface p-4">
            <p className="text-xs font-medium tracking-wide text-accent uppercase">
              2. Trust
            </p>
            <p className="mt-1 text-sm text-muted">
              AgentTrust checks existing monitoring, verification, and
              reliability evidence for that URL.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-surface p-4">
            <p className="text-xs font-medium tracking-wide text-accent uppercase">
              3. Invoke
            </p>
            <p className="mt-1 text-sm text-muted">
              A machine-readable trustDecision informs whether to proceed.
            </p>
          </div>
        </div>
      </div>

      <div className="border-t border-border">
        <div className="mx-auto w-full max-w-3xl px-6 py-10">
          <h2 className="text-xl font-semibold tracking-tight">
            What you get back
          </h2>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Example — not a live lookup. Try the form above for a real
            result.
          </p>
          <div className="mt-4">
            <TrustDecisionSummary result={EXAMPLE_RESULT} />
          </div>
        </div>
      </div>

      <div className="border-t border-border">
        <div className="mx-auto w-full max-w-3xl px-6 py-10">
          <h2 className="text-xl font-semibold tracking-tight">
            For AI agents and MCP clients
          </h2>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Call the same check directly from an agent or MCP client — read-only,
            and no AgentTrust account or API key required:
          </p>
          <Code>{`check_agent_trust({ endpointUrl })`}</Code>
          <p className="mt-2 text-sm text-muted">
            MCP endpoint:{" "}
            <code className="rounded bg-surface px-1 py-0.5 font-mono text-xs text-foreground">
              https://getagenttrust.com/api/mcp
            </code>
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/docs"
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
            >
              Read the docs
            </Link>
            <Link
              href="/check-agent-trust"
              className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-surface"
            >
              How trust checks work →
            </Link>
          </div>
        </div>
      </div>

      <div className="border-t border-border">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-3 px-6 py-8 text-sm text-muted">
          <p>Registering and monitoring your own agent also takes a minute.</p>
          <div className="flex gap-4">
            <Link href="/signup" className="text-accent hover:underline">
              Create an account
            </Link>
            <Link href="/login" className="hover:text-foreground">
              Log in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
