import Link from "next/link";
import type { Metadata } from "next";

const TITLE = "Check AI Agent Trust Before Invocation | AgentTrust";
const DESCRIPTION =
  "Check the trust and reliability of an AI agent endpoint before invocation using monitoring history, endpoint ownership verification, reliability data, and a machine-readable trustDecision.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/check-agent-trust" },
  openGraph: {
    type: "website",
    siteName: "AgentTrust",
    title: TITLE,
    description: DESCRIPTION,
    url: "/check-agent-trust",
  },
  twitter: {
    card: "summary",
    title: TITLE,
    description: DESCRIPTION,
  },
};

function Code({ children }: { children: string }) {
  return (
    <pre className="mt-2 overflow-x-auto rounded-md border border-border bg-background p-3 font-mono text-xs">
      <code>{children}</code>
    </pre>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <div className="mt-3 flex flex-col gap-3 text-sm text-muted [&_strong]:text-foreground [&_code]:rounded [&_code]:bg-surface [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_code]:text-foreground">
        {children}
      </div>
    </section>
  );
}

const EXAMPLE_MATCHED = `{
  "matched": true,
  "slug": "example-agent",
  "name": "Example Agent",
  "status": "healthy",
  "verified": true,
  "reliabilityScore": 92,
  "trustDecision": {
    "recommended": true,
    "confidence": "high",
    "reasons": []
  }
}`;

export default function CheckAgentTrustPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 py-16">
      <div>
        <p className="text-sm font-medium tracking-wide text-accent uppercase">
          Pre-invocation trust check
        </p>
        <h1 className="mt-1 text-4xl font-semibold tracking-tight text-balance">
          Check an AI Agent Before You Invoke It
        </h1>
        <p className="mt-4 max-w-xl text-muted">
          Check the trust and reliability of an AI agent endpoint before
          invocation. AgentTrust uses existing monitoring history, endpoint
          ownership verification, and reliability data to return a
          machine-readable trustDecision without contacting the target agent
          during the check.
        </p>
      </div>

      <Section title="How it works">
        <p>
          A pre-invocation trust check answers one question: based on what
          AgentTrust already knows about this AI agent endpoint, should you
          proceed?
        </p>
        <ol className="ml-5 list-decimal space-y-1">
          <li>You have an agent endpoint URL you&apos;re about to call.</li>
          <li>
            AgentTrust looks it up among its already-observed public agents —
            an exact match on the invocation URL.
          </li>
          <li>
            If it&apos;s known, AgentTrust reads that agent&apos;s existing
            monitoring history — health checks over time, not a live probe.
          </li>
          <li>
            It also reads the agent&apos;s endpoint ownership verification
            state — whether whoever registered it proved they control that
            endpoint.
          </li>
          <li>
            It combines both into reliability evidence: a deterministic
            score, when there&apos;s enough monitoring history to compute
            one.
          </li>
          <li>
            You get back a machine-readable trustDecision —{" "}
            <code>recommended</code>, <code>confidence</code>, and{" "}
            <code>reasons</code> — to base your own invocation decision on.
          </li>
        </ol>
      </Section>

      <Section title="AgentTrust never contacts the target endpoint">
        <p className="rounded-md border border-accent/30 bg-surface p-3">
          <strong className="text-foreground">Important:</strong> checking an
          agent&apos;s trust does not involve AgentTrust calling that
          agent. A pre-invocation trust check reads AgentTrust&apos;s own
          already-observed data about the endpoint — the monitoring history
          and verification state it has previously collected — not a fresh
          request made to the endpoint at check time. That distinction is
          what makes the check safe to run before you&apos;ve decided the
          endpoint is worth talking to in the first place.
        </p>
      </Section>

      <Section title="For AI agents and MCP clients">
        <p>
          If you&apos;re an AI agent or MCP client evaluating another
          agent&apos;s endpoint — whether discovered via A2A or any other
          means — AgentTrust exposes this same check as an anonymous,
          read-only MCP tool:
        </p>
        <Code>{`check_agent_trust({ endpointUrl })`}</Code>
        <p>
          MCP endpoint:{" "}
          <code>https://getagenttrust.com/api/mcp</code> (Streamable HTTP).
        </p>
        <ul className="ml-5 list-disc space-y-1">
          <li>No AgentTrust API key or account required.</li>
          <li>Read-only — it only reads existing AgentTrust data.</li>
          <li>Exact match on the endpoint URL you supply.</li>
          <li>
            An unknown or unregistered endpoint returns{" "}
            <code>{"{ matched: false }"}</code>, never an error.
          </li>
          <li>
            The check itself does not contact the target endpoint — see
            above.
          </li>
        </ul>
        <p>Example response for a matched, generic fictional endpoint:</p>
        <Code>{EXAMPLE_MATCHED}</Code>
        <p>
          Full request/response detail, including the REST equivalent and
          the other MCP tools, is in the{" "}
          <Link href="/docs#mcp" className="text-accent hover:underline">
            API docs
          </Link>
          .
        </p>
      </Section>

      <Section title="What this is, and isn't">
        <p>
          AgentTrust&apos;s trustDecision is derived from an agent&apos;s
          monitoring history, reliability score, and endpoint ownership
          verification state — signals AgentTrust has itself observed over
          time.
        </p>
        <p>
          It is not a community reputation or rating system, it does not
          offer any security guarantee, and it does not prove an agent is
          safe to use — it reports what AgentTrust has observed so you can
          make your own decision.
        </p>
      </Section>

      <div className="flex gap-3">
        <Link
          href="/docs"
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
        >
          Read the API docs
        </Link>
        <Link
          href="/signup"
          className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-surface"
        >
          Create an account
        </Link>
      </div>
    </div>
  );
}
