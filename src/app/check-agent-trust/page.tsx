import Link from "next/link";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import {
  checkAgentTrustInputSchema,
  mcpCheckAgentTrust,
} from "@/lib/mcp/tools";
import { EndpointCheckForm } from "@/components/check/endpoint-check-form";
import { CodeBlock } from "@/components/dev/code-block";
import { EXAMPLE_ENDPOINT, PRIMARY_EXAMPLE } from "@/components/trust/examples";
import { NotMatchedReport, TrustReport, type TrustReportData } from "@/components/trust/trust-report";
import { Callout } from "@/components/ui/callout";
import { IconAlert, IconCheck, IconClock } from "@/components/ui/icons";

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

type CheckResult =
  | { kind: "matched"; result: TrustReportData & { slug?: string } }
  | { kind: "not_matched" }
  | { kind: "invalid" | "rate_limited" | "error"; message: string };

/**
 * Runs the exact same rate-limited, read-only check the `check_agent_trust`
 * MCP tool runs — `mcpCheckAgentTrust` (src/lib/mcp/tools.ts) — from this
 * page instead of over MCP transport, so a human visitor sees a real,
 * live result rather than a faked one. No new lookup/rate-limit/trust
 * logic is added here; only the incoming request's IP headers are forwarded
 * on, the same way `checkAnonymousRateLimit` already expects them. The
 * outcome is only sorted into the states the page renders.
 */
async function runTrustCheck(endpointUrl: string): Promise<CheckResult> {
  const parsed = checkAgentTrustInputSchema.safeParse({ endpointUrl });
  if (!parsed.success) {
    return {
      kind: "invalid",
      message: parsed.error.issues[0]?.message ?? "Invalid endpoint URL.",
    };
  }

  const incomingHeaders = await headers();
  const request = new Request("https://mcp.internal/check-agent-trust", {
    headers: incomingHeaders,
  });
  const toolResult = await mcpCheckAgentTrust(db, request, parsed.data);

  if (toolResult.isError) {
    const error = toolResult.structuredContent?.error as
      | { message?: string; retryAfterSeconds?: number }
      | undefined;
    const message = error?.message ?? "Something went wrong. Please try again.";
    if (typeof error?.retryAfterSeconds === "number") {
      return { kind: "rate_limited", message: `${message} (retry in ${error.retryAfterSeconds}s)` };
    }
    return { kind: "error", message };
  }

  const result = toolResult.structuredContent as { matched?: boolean } & Partial<TrustReportData>;
  if (!result.matched || !result.trustDecision) return { kind: "not_matched" };
  return { kind: "matched", result: result as TrustReportData };
}

const HOW_IT_WORKS = [
  "Looks the URL up among the public agents AgentTrust already observes — an exact match on the invocation URL.",
  "Reads that agent's existing monitoring history and endpoint ownership verification — not a live probe.",
  "Returns a machine-readable trustDecision — recommended, confidence and reasons — for you to act on.",
];

const MCP_FACTS = [
  "No AgentTrust account or API key",
  "Exact match on the URL you supply",
  "Unknown URL → { matched: false }, never an error",
  "Rate-limited per caller IP",
];

const LINK = "text-accent underline-offset-4 hover:underline";

export default async function CheckAgentTrustPage({
  searchParams,
}: PageProps<"/check-agent-trust">) {
  const { endpointUrl } = await searchParams;
  const query = typeof endpointUrl === "string" ? endpointUrl : undefined;
  const check = query ? await runTrustCheck(query) : undefined;
  const checkedUrl = check && (check.kind === "matched" || check.kind === "not_matched") ? query : undefined;

  return (
    <div className="mx-auto flex w-full max-w-reading flex-col gap-8 px-4 py-10 sm:px-6 sm:py-14">
      {/* What the check does → the input → the action. */}
      <div>
        <p className="eyebrow">Pre-invocation trust check</p>
        <h1 className="mt-2 text-title text-balance sm:text-[1.875rem] sm:leading-tight">
          Check an AI Agent Before You Invoke It
        </h1>
        <p className="mt-3 text-muted">
          Paste the exact endpoint URL your agent is about to call. AgentTrust
          returns a trust decision from the monitoring, reliability and
          ownership evidence it already holds — without contacting the target.
        </p>
        <EndpointCheckForm id="endpointUrl" defaultValue={query ?? ""} className="mt-6" />
      </div>

      {/* The result and its reasons. */}
      {check && (
        <section aria-label="Trust check result" aria-live="polite" className="flex flex-col gap-3">
          {check.kind === "matched" && (
            <>
              <TrustReport data={check.result} endpointUrl={query} headingLevel="h2" />
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs text-muted">
                <p>
                  Reflects AgentTrust&apos;s observed evidence for this exact URL —
                  not a security guarantee, certification or endorsement.
                </p>
                {check.result.slug && (
                  <Link href={`/a/${check.result.slug}`} className={`shrink-0 ${LINK}`}>
                    Public profile →
                  </Link>
                )}
              </div>
            </>
          )}
          {check.kind === "not_matched" && (
            <>
              <NotMatchedReport endpointUrl={query} />
              <p className="text-xs text-muted">
                Matching is exact after standard URL normalization —{" "}
                <Link href="/docs#normalization" className={LINK}>
                  see how
                </Link>
                . Running this agent?{" "}
                <Link href="/signup" className={LINK}>
                  Register it
                </Link>{" "}
                so it can be checked.
              </p>
            </>
          )}
          {check.kind === "rate_limited" && (
            <Callout tone="neutral" icon={IconClock} role="status" title="Too many checks from your network">
              {check.message}
            </Callout>
          )}
          {(check.kind === "invalid" || check.kind === "error") && (
            <Callout tone="caution" icon={IconAlert} role="alert" title="The check didn't run">
              {check.message}
            </Callout>
          )}
        </section>
      )}

      {/* Technical explanation — compact, below the tool. */}
      <section aria-labelledby="how-heading" className="border-t border-border pt-8">
        <h2 id="how-heading" className="text-heading">
          How it works
        </h2>
        <ol className="mt-4 flex flex-col gap-3">
          {HOW_IT_WORKS.map((step, i) => (
            <li key={step} className="flex gap-3 text-sm">
              <span className="font-mono text-xs leading-5 text-subtle">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="text-muted">{step}</span>
            </li>
          ))}
        </ol>
        <Callout tone="info" className="mt-5" title="AgentTrust never contacts the target endpoint">
          A trust check reads only what AgentTrust has already observed — past
          health checks and verification state — so it&apos;s safe to run
          before you&apos;ve decided the endpoint is worth talking to.
        </Callout>
      </section>

      {/* MCP and docs. */}
      <section aria-labelledby="mcp-heading" className="border-t border-border pt-8">
        <h2 id="mcp-heading" className="text-heading">
          For AI agents and MCP clients
        </h2>
        <p className="mt-2 text-sm text-muted">
          The same check is the anonymous, read-only MCP tool{" "}
          <code className="font-mono text-xs text-foreground">check_agent_trust</code> at{" "}
          <code className="font-mono text-xs break-all text-foreground">https://getagenttrust.com/api/mcp</code>{" "}
          (Streamable HTTP).
        </p>
        <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          {MCP_FACTS.map((fact) => (
            <li key={fact} className="flex gap-2">
              <IconCheck className="mt-0.5 size-4 shrink-0 text-positive" />
              <span>{fact}</span>
            </li>
          ))}
        </ul>
        <CodeBlock label="check_agent_trust call">
          {`check_agent_trust({ endpointUrl: "${checkedUrl ?? EXAMPLE_ENDPOINT}" })`}
        </CodeBlock>
        <p className="mt-4 text-xs font-medium">
          Example result <span className="font-normal text-muted">— fictional values</span>
        </p>
        <CodeBlock label="check_agent_trust example result">
          {JSON.stringify(PRIMARY_EXAMPLE, null, 2)}
        </CodeBlock>
        <p className="mt-4 text-sm text-muted">
          Full request/response detail, the REST equivalent and the other MCP
          tools are in the{" "}
          <Link href="/docs#mcp" className={LINK}>
            API docs
          </Link>
          .
        </p>
      </section>

      <section aria-labelledby="scope-heading" className="border-t border-border pt-8">
        <h2 id="scope-heading" className="text-heading">
          What this is, and isn&apos;t
        </h2>
        <p className="mt-2 text-sm text-muted">
          The trustDecision is derived from an agent&apos;s monitoring history,
          reliability score and endpoint ownership verification — signals
          AgentTrust has itself observed over time. It is not a community
          reputation or rating system, offers no security guarantee, and does
          not prove an agent is safe to use: it reports what AgentTrust has
          observed so you can make your own decision.
        </p>
      </section>
    </div>
  );
}
