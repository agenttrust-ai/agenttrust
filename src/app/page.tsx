import Link from "next/link";
import type { Metadata } from "next";
import { publicEnv } from "@/lib/config";
import {
  MIN_SAMPLES_FOR_SCORE,
  SCORE_THRESHOLD_HIGH_CONFIDENCE,
  SCORE_THRESHOLD_RECOMMENDED,
  SCORE_WINDOW_DAYS,
} from "@/lib/reliability/scoring";
import { WELL_KNOWN_VERIFICATION_PATH } from "@/lib/verification/ownership";
import { EndpointCheckForm } from "@/components/check/endpoint-check-form";
import { CodeBlock } from "@/components/dev/code-block";
import { CopyButton } from "@/components/dev/copy-button";
import { TrustReport, type TrustReportData } from "@/components/trust/trust-report";
import { EXAMPLE_ENDPOINT, PRIMARY_EXAMPLE, exampleResult } from "@/components/trust/examples";
import { buttonClass } from "@/components/ui/button";
import { IconArrowRight, IconCheck } from "@/components/ui/icons";

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

const MCP_SERVER_URL = "https://getagenttrust.com/api/mcp";

/** AgentTrust's own test agent — safe to use as a live example. */
const LIVE_EXAMPLE_ENDPOINT = "https://agenttrust-umber.vercel.app/api/test-agent";

const OUTCOMES: { data: TrustReportData; caption: string }[] = [
  {
    data: exampleResult({
      name: "Unverified Agent",
      slug: "unverified-agent",
      status: "healthy",
      score: 88,
      scoreStatus: "fresh",
      verified: false,
    }),
    caption: `Healthy, with a current score of at least ${SCORE_THRESHOLD_RECOMMENDED}. Recommended — at low confidence until its owner verifies the endpoint.`,
  },
  {
    data: exampleResult({
      name: "Failing Agent",
      slug: "failing-agent",
      status: "down",
      score: 42,
      scoreStatus: "fresh",
      verified: true,
    }),
    caption: `Down, and a current score below ${SCORE_THRESHOLD_RECOMMENDED}. Either one alone rules out a recommendation.`,
  },
  {
    data: exampleResult({
      name: "Quiet Agent",
      slug: "quiet-agent",
      status: "healthy",
      score: 97,
      scoreStatus: "stale",
      verified: false,
    }),
    caption:
      "Its last score is out of date. It's shown for reference, but never used for a recommendation.",
  },
];

const MCP_REQUEST = JSON.stringify(
  {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "check_agent_trust", arguments: { endpointUrl: EXAMPLE_ENDPOINT } },
  },
  null,
  2,
);

const MCP_RESULT = JSON.stringify(PRIMARY_EXAMPLE, null, 2);

const FLOW = [
  {
    step: "01",
    title: "Discover",
    body: "Your agent finds another agent's endpoint — in an A2A Agent Card, a registry, or its own configuration.",
    code: "endpointUrl",
  },
  {
    step: "02",
    title: "Trust",
    body: "Before calling it, your agent asks AgentTrust, which reads the evidence it already holds for that exact URL.",
    code: "check_agent_trust({ endpointUrl })",
  },
  {
    step: "03",
    title: "Invoke",
    body: "Proceed on a recommendation, or apply your own policy to the confidence and reasons. The decision stays yours.",
    code: "trustDecision.recommended",
  },
];

const EVIDENCE = [
  {
    term: "Health status",
    detail:
      "Healthy, degraded or down — derived from consecutive results of scheduled health checks, or heartbeats for push-mode agents.",
  },
  {
    term: "Reliability score",
    detail: `0–100 from the last ${SCORE_WINDOW_DAYS} days of checks: uptime, latency, consistency and incidents. Computed once there are at least ${MIN_SAMPLES_FOR_SCORE} checks.`,
  },
  {
    term: "Evidence freshness",
    detail: `Current while there are at least ${MIN_SAMPLES_FOR_SCORE} checks in the last ${SCORE_WINDOW_DAYS} days. An out-of-date score is shown for reference but never counts toward a recommendation.`,
  },
  {
    term: "Endpoint ownership",
    detail: `The owner publishes a token at ${WELL_KNOWN_VERIFICATION_PATH} on the endpoint's origin. Optional — it raises confidence, but is never required for a recommendation.`,
  },
];

const MCP_FACTS = [
  "Read-only — reads AgentTrust's existing observations",
  "No AgentTrust account or API key needed for check_agent_trust",
  "Exact match on the endpoint URL you pass",
  "Machine-readable trustDecision: recommended, confidence, reasons",
  "Never contacts the endpoint being checked",
  "Anonymous calls are rate-limited per caller IP",
];

function SectionHeading({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="max-w-2xl">
      <p className="eyebrow">{eyebrow}</p>
      <h2 id={id} className="mt-2 text-title text-balance">
        {title}
      </h2>
      {children && <p className="mt-3 text-sm text-muted">{children}</p>}
    </div>
  );
}

const LINK = "text-accent underline-offset-4 hover:underline";

export default function Home() {
  return (
    <div className="flex flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(STRUCTURED_DATA).replace(/</g, "\\u003c"),
        }}
      />

      {/* 1 — Hero: the trust check itself, next to the object it returns. */}
      <section className="relative isolate border-b border-border">
        <div aria-hidden="true" className="bg-grid pointer-events-none absolute inset-0 -z-10" />
        <div className="mx-auto grid w-full max-w-shell gap-10 px-4 pt-10 pb-12 sm:px-6 sm:pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)] lg:items-center lg:gap-10 lg:pt-16 lg:pb-16 xl:grid-cols-[minmax(0,1fr)_minmax(0,29rem)] xl:gap-14 xl:pt-20 xl:pb-20">
          <div>
            <p className="eyebrow">Trust infrastructure for AI agents</p>
            <h1 className="mt-3 text-display text-balance xl:text-[2.75rem] xl:leading-[1.08]">
              Know whether to trust an agent before you call it.
            </h1>
            <p className="mt-4 max-w-xl text-muted">
              AgentTrust checks an agent endpoint against the monitoring,
              reliability and ownership evidence it has already collected, and
              returns a machine-readable trust decision — without contacting the
              endpoint.
            </p>
            <EndpointCheckForm id="home-endpoint-url" className="mt-7 max-w-xl" />
            <p className="mt-4 text-sm text-muted">
              No endpoint handy?{" "}
              <Link
                href={`/check-agent-trust?endpointUrl=${encodeURIComponent(LIVE_EXAMPLE_ENDPOINT)}`}
                prefetch={false}
                className={LINK}
              >
                Check AgentTrust&apos;s own test agent
              </Link>
            </p>
          </div>

          <div>
            <TrustReport
              data={PRIMARY_EXAMPLE}
              endpointUrl={EXAMPLE_ENDPOINT}
              example
              headingLevel="p"
            />
            <p className="mt-2 text-xs text-subtle">
              Illustrative data for a fictional agent — not a live lookup.
            </p>
          </div>
        </div>
      </section>

      {/* 2 — Where AgentTrust sits in an agent's call path. */}
      <section aria-labelledby="flow-heading" className="border-b border-border bg-surface">
        <div className="mx-auto w-full max-w-shell px-4 py-12 sm:px-6">
          <SectionHeading id="flow-heading" eyebrow="Where it fits" title="Discover → Trust → Invoke" />
          <ol className="mt-6 grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-3">
            {FLOW.map((item) => (
              <li key={item.step} className="flex flex-col gap-2 bg-background p-5">
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-xs text-subtle">{item.step}</span>
                  <h3 className="text-heading">{item.title}</h3>
                </div>
                <p className="text-sm text-muted">{item.body}</p>
                <code className="mt-auto self-start rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-xs break-all">
                  {item.code}
                </code>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* 3 — The output model: every verdict, always with reasons. */}
      <section aria-labelledby="outcomes-heading" className="border-b border-border">
        <div className="mx-auto w-full max-w-shell px-4 py-12 sm:px-6 sm:py-16">
          <SectionHeading
            id="outcomes-heading"
            eyebrow="What you get back"
            title="Three verdicts, always with reasons."
          >
            Every check returns a trustDecision computed only from evidence
            AgentTrust already holds. These examples are illustrative, produced
            by AgentTrust&apos;s own decision logic.
          </SectionHeading>
          <div className="mt-8 grid gap-6 lg:grid-cols-3 lg:gap-4">
            {OUTCOMES.map((outcome) => (
              <div key={outcome.data.slug} className="flex flex-col gap-3">
                <TrustReport data={outcome.data} example headingLevel="h3" compact />
                <p className="text-sm text-muted">{outcome.caption}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-2 rounded-lg border border-dashed border-border-strong p-4 sm:flex-row sm:items-center sm:gap-4">
            <code className="shrink-0 font-mono text-sm">{`{ "matched": false }`}</code>
            <p className="text-sm text-muted">
              The endpoint isn&apos;t in AgentTrust&apos;s directory, so there is no
              evidence either way — an unknown, not an error.
            </p>
          </div>
        </div>
      </section>

      {/* 4 — The evidence and the rule that turns it into a decision. */}
      <section aria-labelledby="evidence-heading" className="border-b border-border">
        <div className="mx-auto grid w-full max-w-shell gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <div>
            <SectionHeading
              id="evidence-heading"
              eyebrow="What AgentTrust evaluates"
              title="Observed evidence, one deterministic rule."
            />
            <div className="mt-6 rounded-lg border border-border bg-surface-2 p-4 font-mono text-xs leading-relaxed">
              <p className="text-muted">{"// recommended"}</p>
              <p>
                status is <span className="text-positive">healthy</span> AND a
                current score ≥ {SCORE_THRESHOLD_RECOMMENDED}
              </p>
              <p className="mt-3 text-muted">{"// confidence"}</p>
              <ul className="flex flex-col gap-0.5">
                <li>
                  high <span className="text-muted">— verified and score ≥ {SCORE_THRESHOLD_HIGH_CONFIDENCE}</span>
                </li>
                <li>
                  medium <span className="text-muted">— verified and score ≥ {SCORE_THRESHOLD_RECOMMENDED}</span>
                </li>
                <li>
                  low <span className="text-muted">— not verified, or score below {SCORE_THRESHOLD_RECOMMENDED}</span>
                </li>
                <li>
                  insufficient_data <span className="text-muted">— no current score</span>
                </li>
              </ul>
            </div>
            <p className="mt-4 text-sm text-muted">
              Not a community rating and not a security guarantee — AgentTrust
              reports what it has observed so you can decide.
            </p>
          </div>

          <dl className="divide-y divide-border border-y border-border">
            {EVIDENCE.map((item) => (
              <div key={item.term} className="grid gap-1 py-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-6">
                <dt className="text-sm font-medium">{item.term}</dt>
                <dd className="text-sm text-muted [overflow-wrap:anywhere]">{item.detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* 5 — The same capability for agents and developers. */}
      <section aria-labelledby="mcp-heading" className="border-b border-border bg-surface">
        <div className="mx-auto grid w-full max-w-shell gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,34rem)]">
          <div>
            <SectionHeading id="mcp-heading" eyebrow="For AI agents and developers" title="The same check, over MCP.">
              Any MCP client can call check_agent_trust before invoking an
              unknown agent.
            </SectionHeading>
            <ul className="mt-6 flex flex-col gap-2.5">
              {MCP_FACTS.map((fact) => (
                <li key={fact} className="flex gap-2.5 text-sm">
                  <IconCheck className="mt-0.5 size-4 shrink-0 text-positive" />
                  <span>{fact}</span>
                </li>
              ))}
            </ul>
            <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm">
              <Link href="/docs#mcp" className={LINK}>
                MCP reference
              </Link>
              <Link href="/docs#lookup" className={LINK}>
                REST lookup (API key)
              </Link>
            </div>
          </div>

          <div className="min-w-0">
            <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2">
              <div className="min-w-0">
                <p className="eyebrow">MCP server · Streamable HTTP</p>
                <p className="truncate font-mono text-sm">{MCP_SERVER_URL}</p>
              </div>
              <CopyButton text={MCP_SERVER_URL} label="Copy MCP server URL" />
            </div>
            <p className="mt-5 text-xs font-medium">Tool call</p>
            <CodeBlock label="check_agent_trust tool call">{MCP_REQUEST}</CodeBlock>
            <p className="mt-5 text-xs font-medium">
              Result <span className="font-normal text-muted">— structuredContent, example</span>
            </p>
            <CodeBlock label="check_agent_trust example result">{MCP_RESULT}</CodeBlock>
          </div>
        </div>
      </section>

      {/* 6 — Back to the check. */}
      <section aria-labelledby="cta-heading">
        <div className="mx-auto w-full max-w-shell px-4 py-12 sm:px-6 sm:py-16">
          <div className="grid gap-8 rounded-lg border border-border bg-surface p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:items-center">
            <div>
              <h2 id="cta-heading" className="text-title text-balance">
                Check an agent before you call it.
              </h2>
              <p className="mt-3 text-sm text-muted">
                Paste its exact endpoint URL. Running your own agent?{" "}
                <Link href="/signup" className={LINK}>
                  Register it
                </Link>{" "}
                so others can check it too.
              </p>
            </div>
            <EndpointCheckForm id="cta-endpoint-url" />
          </div>
          <div className="mt-6 flex justify-center">
            <Link href="/docs" className={buttonClass({ variant: "ghost" })}>
              Read the documentation
              <IconArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
