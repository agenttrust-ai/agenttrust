import type { Metadata } from "next";
import type { ReactNode } from "react";
import { CodeBlock as Code } from "@/components/dev/code-block";
import { CopyButton } from "@/components/dev/copy-button";
import { Callout } from "@/components/ui/callout";

export const metadata: Metadata = {
  title: "API Reference — AgentTrust",
  description:
    "How to authenticate, look up an agent by endpoint URL, and interpret its trust decision — REST and MCP.",
};

/**
 * One list drives both the desktop sticky sidebar and the mobile "On this
 * page" disclosure — every id here is a real section/anchor already on the
 * page, so this is pure navigation, not new content.
 */
const DOCS_NAV_ITEMS = [
  { id: "quick-start", label: "Quick Start" },
  { id: "mcp", label: "MCP" },
  { id: "getting-started", label: "Getting started (REST)" },
  { id: "workflow", label: "The workflow" },
  { id: "auth", label: "Authentication" },
  { id: "trust-decision", label: "Trust Decision" },
  { id: "monitoring", label: "Monitoring" },
  { id: "verification", label: "Verification" },
  { id: "lookup", label: "Trust-check lookup" },
  { id: "normalization", label: "URL normalization" },
  { id: "endpoints", label: "Other endpoints" },
  { id: "rate-limits", label: "Rate limits" },
  { id: "errors", label: "Common errors" },
  { id: "not-built", label: "Not yet built" },
] as const;

const MCP_URL = "https://getagenttrust.com/api/mcp";

/** The facts a developer looks for first — each is detailed further down. */
const AT_A_GLANCE: { label: string; value: string; note: string; copy?: boolean }[] = [
  { label: "MCP server", value: MCP_URL, note: "Streamable HTTP", copy: true },
  { label: "Trust check (MCP)", value: "check_agent_trust({ endpointUrl })", note: "No API key or account" },
  { label: "Trust check (REST)", value: "GET /api/v1/agents?endpoint_url=", note: "API key required" },
  { label: "Authentication", value: "Authorization: Bearer <API_KEY>", note: "REST and keyed MCP tools" },
];

const PROSE =
  "flex flex-col gap-3 text-sm leading-relaxed text-muted [&_strong]:text-foreground " +
  "[&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_code]:text-foreground " +
  "[&_a]:text-accent [&_a]:underline-offset-4 [&_a:hover]:underline";

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-20 border-t border-border pt-10">
      <h2 id={`${id}-heading`} className="text-heading">
        <a href={`#${id}`} className="group inline-flex items-baseline gap-2">
          {title}
          <span aria-hidden="true" className="font-mono text-sm text-subtle opacity-0 group-hover:opacity-100">
            #
          </span>
        </a>
      </h2>
      <div className={`mt-4 ${PROSE}`}>{children}</div>
    </section>
  );
}

/** One numbered step: a scannable title line, then its detail. */
function Step({
  n,
  id,
  title,
  children,
}: {
  n: number;
  id?: string;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <li id={id} className="grid scroll-mt-20 grid-cols-[2rem_minmax(0,1fr)] gap-x-2 border-b border-border py-4 first:pt-1 last:border-0">
      <span className="font-mono text-xs leading-6 text-subtle">{String(n).padStart(2, "0")}</span>
      <div>
        <p className="font-medium text-foreground">{title}</p>
        <div className="mt-1 flex flex-col gap-2">{children}</div>
      </div>
    </li>
  );
}

const LOOKUP_RESPONSE_EXAMPLE = `{
  "data": [
    {
      "id": "3fa1c2b0-1234-4a5b-8c9d-abcdef123456",
      "slug": "acme-support-bot",
      "name": "Acme Support Bot",
      "description": "Handles tier-1 customer support requests.",
      "version": "1.2.0",
      "capabilities": ["chat", "ticket-triage"],
      "status": "healthy",
      "createdAt": "2026-01-15T10:00:00.000Z",
      "agentCard": {
        "schemaVersion": "1.0",
        "name": "Acme Support Bot",
        "description": "Handles tier-1 customer support requests.",
        "capabilities": ["chat", "ticket-triage"],
        "authentication": { "type": "none" },
        "interfaces": { "modalities": ["text"], "interactionType": "request-response" },
        "documentationUrl": null
      },
      "source": "owner_registered",
      "verified": false,
      "ownershipVerifiedAt": null,
      "reliabilityScore": 97,
      "reliabilityScoreStatus": "fresh",
      "reliabilityScoreComputedAt": "2026-09-14T00:44:16.440Z",
      "lastCheckedAt": "2026-09-14T00:44:13.152Z",
      "latencyMs": 142,
      "httpStatus": 200,
      "trustDecision": {
        "recommended": true,
        "confidence": "low",
        "reasons": ["Endpoint ownership has not been verified."]
      }
    }
  ],
  "pagination": { "nextCursor": null }
}`;

const NAV_LINK = "rounded-sm px-2 py-1 text-muted transition-[color,background-color] duration-150 hover:bg-surface-2 hover:text-foreground";

export default function DocsPage() {
  return (
    <div className="mx-auto flex w-full max-w-shell items-start gap-12 px-4 py-10 sm:px-6 sm:py-14">
      <nav aria-label="On this page" className="sticky top-20 hidden w-48 shrink-0 flex-col gap-0.5 text-sm lg:flex">
        <p className="eyebrow mb-2 px-2">On this page</p>
        {DOCS_NAV_ITEMS.map((item) => (
          <a key={item.id} href={`#${item.id}`} className={NAV_LINK}>
            {item.label}
          </a>
        ))}
      </nav>

      <div className="flex min-w-0 max-w-[46rem] flex-1 flex-col gap-10">
        <header>
          <p className="eyebrow">API reference</p>
          <h1 className="mt-2 text-title text-balance sm:text-[1.875rem] sm:leading-tight">
            Use AgentTrust from another AI agent
          </h1>
          <p className={`mt-3 ${PROSE} text-base`}>
            <span>
              Everything below is also available as a plain-text file at{" "}
              <a href="/llms.txt">/llms.txt</a> — built for pasting into an
              LLM&apos;s context or reading programmatically. Base URL for every
              example on this page: <code>https://getagenttrust.com</code>
            </span>
          </p>

          <dl className="mt-6 divide-y divide-border rounded-lg border border-border bg-surface">
            {AT_A_GLANCE.map((item) => (
              <div key={item.label} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                <dt className="eyebrow shrink-0 sm:w-40">{item.label}</dt>
                <dd className="flex min-w-0 flex-1 items-center justify-between gap-3">
                  <span className="min-w-0">
                    <code className="font-mono text-sm break-all text-foreground">{item.value}</code>
                    <span className="block text-xs text-muted">{item.note}</span>
                  </span>
                  {item.copy && <CopyButton text={item.value} label={`Copy ${item.label}`} />}
                </dd>
              </div>
            ))}
          </dl>
        </header>

        <details className="rounded-lg border border-border bg-surface p-3 text-sm lg:hidden">
          <summary className="cursor-pointer font-medium">On this page</summary>
          <nav aria-label="On this page" className="mt-2 flex flex-col gap-0.5">
            {DOCS_NAV_ITEMS.map((item) => (
              <a key={item.id} href={`#${item.id}`} className={NAV_LINK}>
                {item.label}
              </a>
            ))}
          </nav>
        </details>

        <Section id="quick-start" title="Quick Start">
          <Callout tone="info" title="5-minute beta path">
            <a href="/signup">Sign up</a> → Dashboard → API keys → Create key →
            Dashboard → Agents → Register agent → Activate agent →{" "}
            <a href="#getting-started">
              call <code>?endpoint_url=</code>
            </a>{" "}
            and read <code>trustDecision</code> from the response. Skip
            ownership verification for now — it&apos;s optional (see{" "}
            <a href="#verification">Step 5</a>).
          </Callout>
        </Section>

        <Section id="mcp" title="MCP">
          <p>
            Endpoint: <code>{MCP_URL}</code> (GET and POST, Streamable HTTP
            transport). Auth: the same Bearer token as REST, in the{" "}
            <code>Authorization</code> header — except{" "}
            <code>check_agent_trust</code>, below, which needs none.{" "}
            <code>tools/list</code> works without a key; calling any other tool
            requires one (the same 401 as REST on a missing/bad key).
          </p>
          <Callout tone="info" title={<code className="!bg-transparent !px-0 text-sm">check_agent_trust({"{endpointUrl}"})</code>}>
            The preferred check before invoking an unknown external agent. No
            API key or account required. Read-only, and never contacts{" "}
            <code>endpointUrl</code> itself — it only reads AgentTrust&apos;s
            own already-observed data. Returns{" "}
            <code>{"{ matched: false }"}</code> for an unregistered URL, or{" "}
            <code>
              {
                "{ matched: true, slug, name, status, verified, reliabilityScore, reliabilityScoreStatus, trustDecision }"
              }
            </code>{" "}
            for a known public+active agent. Anonymous calls are rate-limited
            per caller IP; a <code>429</code> carries{" "}
            <code>retryAfterSeconds</code>. See{" "}
            <a href="/check-agent-trust">Check an AI Agent Before You Invoke It</a>{" "}
            for a plain-language walkthrough of this check.
          </Callout>
          <p>
            Tools requiring an API key (each backed by the exact same handler as
            its REST equivalent):
          </p>
          <ul className="flex flex-col gap-2">
            <li>
              <code>list_agents({"{limit?, cursor?, endpointUrl?}"})</code> —{" "}
              <code>endpointUrl</code> triggers the same trust-check enrichment
              as the REST <code>?endpoint_url=</code> filter, plus the full
              public agent record (agent card, capabilities, etc.) that{" "}
              <code>check_agent_trust</code> deliberately omits.
            </li>
            <li>
              <code>get_agent({"{slug}"})</code> — same enriched shape as{" "}
              <code>GET /agents/{"{slug}"}</code>.
            </li>
            <li>
              <code>get_agent_health({"{slug}"})</code> — same as{" "}
              <code>GET /agents/{"{slug}"}/health</code>.
            </li>
            <li>
              <code>send_heartbeat({"{slug}"})</code> — owner-only, same as{" "}
              <code>POST /agents/{"{slug}"}/heartbeat</code>.
            </li>
          </ul>
          <p>Example — list_agents with endpointUrl:</p>
          <Code>{`Request:  { "endpointUrl": "https://api.example-acme.com/v1/invoke" }
Response: structuredContent.agents[0] has the exact same fields as
          the REST example above.`}</Code>
        </Section>

        <Section id="getting-started" title="Getting started">
          <ol>
            <Step n={1} title="Create an account">
              <p>
                Sign up at <code>/signup</code> with email + password; confirm
                your email before continuing. There&apos;s no
                programmatic/self-service account-creation API yet — this one
                step is manual.
              </p>
            </Step>
            <Step n={2} title="Create an API key">
              <p>
                Dashboard → API keys → Create key. The raw key is shown{" "}
                <strong>exactly once</strong> — copy it immediately. Use it as{" "}
                <code>Authorization: Bearer YOUR_API_KEY</code> on every request
                below (see Authentication further down for error details).
              </p>
            </Step>
            <Step n={3} title="Register an agent">
              <p>
                Dashboard → Agents → Register agent. Required: <code>name</code>,{" "}
                <code>endpointUrl</code> (must be <code>https://</code>).
                Optional: <code>description</code>, <code>version</code>,{" "}
                <code>authType</code> (<code>none</code> / <code>api_key</code> /{" "}
                <code>bearer</code> — how AgentTrust&apos;s monitor authenticates
                to <em>your</em> endpoint, with a credential stored encrypted and
                never exposed back), and <code>capabilities</code>{" "}
                (comma-separated tags). The agent starts as a private{" "}
                <code>draft</code> — not monitored, not publicly visible yet.
              </p>
            </Step>
            <Step n={4} title="Configure the agent endpoint">
              <p>
                This is just the <code>endpointUrl</code> (and{" "}
                <code>authType</code>/credential, if your endpoint needs one)
                from Step 3 — it&apos;s the exact URL other callers will look you
                up by. It must be reachable over HTTPS and must not point at a
                private/internal/localhost address; registration rejects those.
              </p>
            </Step>
            <Step n={5} id="verification" title="Endpoint ownership verification (optional)">
              <p>
                On the agent&apos;s dashboard page: Start verification → publish
                a file at the given URL containing the given token → Check now.
                This proves you control the endpoint, not just that something
                answers there. Checks are throttled to one per 60 seconds per
                agent.
              </p>
              <Callout tone="neutral">
                <strong>
                  Verification is entirely optional and never gates{" "}
                  <code>recommended</code>
                </strong>{" "}
                — an unverified agent with strong health/reliability history can
                still be <code>recommended: true</code>. Verification only raises{" "}
                <code>confidence</code>, and its absence always appears as one
                entry in <code>reasons</code> — it&apos;s a signal, not a hard
                requirement.
              </Callout>
            </Step>
            <Step n={6} id="monitoring" title="Let monitoring collect health/reliability data">
              <p>
                Click <strong>Activate agent</strong> on its dashboard page —
                this makes it public and puts it on the monitoring schedule.
                Pull-mode (default) checks run once per day via cron, and{" "}
                <code>reliabilityScore</code> stays <code>null</code> (shown as{" "}
                <strong>&quot;Not enough data yet&quot;</strong>) until at least 5
                checks exist, which can take several days in pull mode. For a
                faster first score, send a heartbeat instead:{" "}
                <code>POST /api/v1/agents/{"{slug}"}/heartbeat</code> (owner-only,
                same Bearer auth).
              </p>
            </Step>
            <Step n={7} title="Discover an agent by endpoint URL">
              <p>
                <code>GET /api/v1/agents?endpoint_url=&lt;url&gt;</code> — exact
                match against the <code>endpointUrl</code> you registered (see{" "}
                <a href="#normalization">URL normalization</a> for what&apos;s
                normalized). An unregistered URL returns <code>200</code> with an
                empty <code>data</code> array, never an error.
              </p>
            </Step>
            <Step n={8} title="Request/read the trust decision">
              <p>
                The Step 7 response already includes <code>trustDecision</code>{" "}
                — there&apos;s no separate call. See{" "}
                <a href="#trust-decision">Interpreting trustDecision</a> below for
                exactly what <code>recommended</code>/<code>confidence</code>/
                <code>reasons</code> mean.
              </p>
            </Step>
          </ol>
          <p>Your first call — also the trust lookup itself:</p>
          <Code>{`curl -s "https://getagenttrust.com/api/v1/agents?endpoint_url=YOUR_AGENT_ENDPOINT" \\
  -H "Authorization: Bearer YOUR_API_KEY"

# YOUR_AGENT_ENDPOINT must be URL-encoded, e.g.
# https%3A%2F%2Fyour-agent.example.com%2Fv1%2Finvoke`}</Code>
          <p>Response shape (fictional values):</p>
          <Code>{LOOKUP_RESPONSE_EXAMPLE}</Code>
        </Section>

        <Section id="workflow" title="The workflow">
          <p>
            The thing AgentTrust is actually for: another AI agent has a URL
            it&apos;s about to call, and wants to know whether it should.
          </p>
          <ol className="flex list-decimal flex-col gap-2 pl-5 marker:font-mono marker:text-xs marker:text-subtle">
            <li>
              Discover — this page, <code>/llms.txt</code>, or AgentTrust&apos;s
              own A2A Agent Card at <code>/.well-known/agent-card.json</code>{" "}
              (for A2A-capable agents/clients).
            </li>
            <li>
              Authenticate — for REST and the keyed MCP tools, a human creates an
              API key once, via the dashboard (see below), and it&apos;s sent as{" "}
              <code>Authorization: Bearer &lt;API_KEY&gt;</code>. The anonymous
              MCP tool <code>check_agent_trust</code> needs no key.
            </li>
            <li>
              Look up the agent by the URL you&apos;re about to call:{" "}
              <code>GET /api/v1/agents?endpoint_url=&lt;url&gt;</code>
            </li>
            <li>
              Receive trust information: reliability score, status, verification
              state, and the latest health check.
            </li>
            <li>
              Interpret <code>trustDecision</code>: <code>recommended</code>,{" "}
              <code>confidence</code>, and <code>reasons</code>.
            </li>
            <li>
              Make your own policy decision — e.g. only proceed when{" "}
              <code>recommended === true</code>, or apply a stricter rule
              yourself using <code>confidence</code>/<code>verified</code>{" "}
              directly.
            </li>
          </ol>
        </Section>

        <Section id="auth" title="Authentication">
          <p>
            Every <code>/api/v1/*</code> request requires{" "}
            <code>Authorization: Bearer &lt;API_KEY&gt;</code>. Getting a key is
            a one-time human step — sign up, then Dashboard → API keys → Create
            key. There is currently no unauthenticated or self-service
            account-creation API; a human owns the account.
          </p>
          <p>
            <strong>The raw key is shown exactly once</strong>, at the moment
            you create it — copy it immediately. AgentTrust stores only a hash
            and can never show it to you again; if you lose it, revoke it and
            create a new one.
          </p>
          <p>
            <strong>Revoked keys stay visible</strong> in your dashboard&apos;s
            key list — kept for audit/usage history — but can never authenticate
            again once revoked. That&apos;s intentional, not a bug.
          </p>
          <p>Missing key:</p>
          <Code>{`401
{"error":{"code":"UNAUTHENTICATED","message":"Missing API key. Provide one as: Authorization: Bearer <API_KEY>"}}`}</Code>
          <p>Invalid, expired, or revoked key:</p>
          <Code>{`401
{"error":{"code":"UNAUTHENTICATED","message":"Invalid, expired, or revoked API key."}}`}</Code>
        </Section>

        <Section id="rate-limits" title="Rate limits">
          <p>
            100 requests / 60 seconds, per API key, fixed window. Every response
            carries <code>X-RateLimit-Limit</code>,{" "}
            <code>X-RateLimit-Remaining</code>, and{" "}
            <code>X-RateLimit-Reset</code> headers.
          </p>
          <p>Over the limit:</p>
          <Code>{`429
Retry-After: 37
{"error":{"code":"RATE_LIMITED","message":"Rate limit exceeded. Try again later."}}`}</Code>
        </Section>

        <Section id="lookup" title="Trust-check lookup — GET /api/v1/agents?endpoint_url=">
          <p>
            The entry point for the workflow above. Exact match only (see
            Normalization below) against an agent&apos;s registered endpoint
            URL. Returns the same envelope as the plain listing, but each
            matched agent is additionally enriched with{" "}
            <code>reliabilityScore</code>, <code>reliabilityScoreStatus</code>,{" "}
            <code>reliabilityScoreComputedAt</code>, <code>lastCheckedAt</code>,{" "}
            <code>latencyMs</code>, <code>httpStatus</code>, and{" "}
            <code>trustDecision</code>. An unregistered URL returns{" "}
            <code>200</code> with an empty <code>data</code> array — never an
            error.
          </p>
          <p>Example request:</p>
          <Code>{`GET /api/v1/agents?endpoint_url=https%3A%2F%2Fapi.example-acme.com%2Fv1%2Finvoke
Authorization: Bearer at_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`}</Code>
          <p>Example response (fictional values):</p>
          <Code>{LOOKUP_RESPONSE_EXAMPLE}</Code>
          <p>
            This is a realistic pattern, not a corner case: a strong, healthy,{" "}
            <strong>unverified</strong> agent is still{" "}
            <code>recommended: true</code> — see &quot;Interpreting
            trustDecision&quot; below for why.
          </p>
          <p>
            <code>source</code> (<code>&quot;owner_registered&quot;</code> |{" "}
            <code>&quot;externally_observed&quot;</code>): how the agent entered
            AgentTrust. <code>owner_registered</code> means a human registered
            and activated it. <code>externally_observed</code> means AgentTrust
            discovered it from a public agent registry on nobody&apos;s behalf —
            it is always unclaimed and unverified, exactly like any other
            unverified agent; <code>source</code> is provenance, not a trust
            signal by itself.
          </p>
        </Section>

        <Section id="normalization" title="URL normalization">
          <p>
            Exact match only — never fuzzy or partial. Both the URL you pass and
            each registered URL go through standard URL parsing, plus one extra
            rule, before comparing:
          </p>
          <ol className="flex list-decimal flex-col gap-2 pl-5 marker:font-mono marker:text-xs marker:text-subtle">
            <li>
              A trailing slash on a non-root path (<code>.../invoke/</code>{" "}
              matches <code>.../invoke</code>).
            </li>
            <li>
              Scheme/host casing (<code>HTTPS://Example.com</code> matches{" "}
              <code>https://example.com</code>), and the other effects of
              standard URL parsing — for example, a default port is dropped (
              <code>https://example.com:443/a</code> matches{" "}
              <code>https://example.com/a</code>).
            </li>
          </ol>
          <p>
            Nothing else is normalized — path casing, query strings, fragments
            and non-default ports are compared exactly as given.
          </p>
        </Section>

        <Section id="trust-decision" title="Interpreting trustDecision">
          <p>
            Derived entirely from an agent&apos;s existing status, reliability
            score, and verification state —{" "}
            <strong>never a second, independent score</strong>.
          </p>
          <p>
            <code>recommended</code> (boolean): true only when{" "}
            <code>status === &quot;healthy&quot;</code> AND{" "}
            <code>reliabilityScore !== null</code> AND{" "}
            <code>reliabilityScore &gt;= 50</code> AND{" "}
            <code>reliabilityScoreStatus === &quot;fresh&quot;</code>.
          </p>
          <p>
            <code>reliabilityScoreStatus</code> (<code>&quot;none&quot;</code>{" "}
            | <code>&quot;fresh&quot;</code> | <code>&quot;stale&quot;</code>):{" "}
            <code>none</code> — no score computed yet; <code>fresh</code> — at
            least 5 health checks in the last 7 days (the same evidence the
            score itself requires); <code>stale</code> — a score exists but
            current monitoring no longer supports it.{" "}
            <strong>
              A stale <code>reliabilityScore</code> is the last computed value,
              kept for reference — not current evidence
            </strong>
            , and never makes an agent <code>recommended</code>.
          </p>
          <p>
            <code>confidence</code> (<code>&quot;high&quot;</code> |{" "}
            <code>&quot;medium&quot;</code> | <code>&quot;low&quot;</code> |{" "}
            <code>&quot;insufficient_data&quot;</code>):
          </p>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 marker:text-subtle">
            <li>
              <code>insufficient_data</code> if <code>reliabilityScore</code> is{" "}
              <code>null</code> (not enough monitoring history yet) or{" "}
              <code>reliabilityScoreStatus</code> is{" "}
              <code>&quot;stale&quot;</code>.
            </li>
            <li>
              otherwise <code>low</code> if the agent is unverified, regardless
              of score.
            </li>
            <li>
              otherwise <code>high</code> if score ≥ 90, <code>medium</code> if
              score ≥ 50, <code>low</code> below that.
            </li>
          </ul>
          <p>
            <code>reasons</code> (string[]): a plain-language explanation for
            every factor that counted against the agent — empty only when
            nothing did.
          </p>
          <Callout tone="info" title="Verification is a trust signal, not a hard requirement.">
            Ownership verification is optional and does not gate{" "}
            <code>recommended</code> — an unverified agent with strong
            health/reliability history can still be{" "}
            <code>recommended: true</code>. Verification instead affects{" "}
            <code>confidence</code>, and its absence is always spelled out
            explicitly in <code>reasons</code>, so a caller wanting a stricter
            policy (e.g. &quot;only trust verified agents&quot;) can enforce
            that themselves using the raw <code>verified</code> field —
            AgentTrust doesn&apos;t impose that policy for everyone.
          </Callout>
        </Section>

        <Section id="endpoints" title="Other endpoints">
          <dl className="flex flex-col gap-4">
            <div>
              <dt>
                <code>GET /api/v1/agents</code>
              </dt>
              <dd className="mt-1">
                Plain listing of public, active agents (no{" "}
                <code>endpoint_url</code>). Query params: <code>limit</code>{" "}
                (1-100, default 20), <code>cursor</code> (opaque, from a previous
                response&apos;s <code>pagination.nextCursor</code>). No
                trust-decision enrichment — only the base identity/verification
                fields.
              </dd>
            </div>
            <div>
              <dt>
                <code>GET /api/v1/agents/{"{slug}"}</code>
              </dt>
              <dd className="mt-1">
                Same enrichment as the endpoint_url lookup, for one agent by its
                AgentTrust slug. <code>404</code> if the slug doesn&apos;t exist
                or isn&apos;t public+active.
              </dd>
            </div>
            <div>
              <dt>
                <code>GET /api/v1/agents/{"{slug}"}/health</code>
              </dt>
              <dd className="mt-1">
                <code>
                  {
                    "{agentId, slug, status, lastCheckedAt, latencyMs, httpStatus, checkStatus, reliabilityScore, reliabilityScoreStatus, reliabilityScoreComputedAt}"
                  }
                </code>
              </dd>
            </div>
            <div>
              <dt>
                <code>POST /api/v1/agents/{"{slug}"}/heartbeat</code>
              </dt>
              <dd className="mt-1">
                Owner-only (the key must belong to that agent&apos;s own
                account); records a push-mode liveness signal. Reads no request
                body. <code>{"{slug, status, lastHeartbeatAt}"}</code>
              </dd>
            </div>
          </dl>
        </Section>

        <Section id="errors" title="Common errors">
          <ul className="flex flex-col gap-2">
            <li>
              <code>401 UNAUTHENTICATED</code> — missing, invalid, expired, or
              revoked key.
            </li>
            <li>
              <code>404 NOT_FOUND</code> — unknown slug on{" "}
              <code>GET /agents/{"{slug}"}</code>. An unknown{" "}
              <code>endpoint_url</code> on the list endpoint is{" "}
              <strong>not</strong> an error — it&apos;s <code>200</code> with an
              empty <code>data</code> array.
            </li>
            <li>
              <code>400 VALIDATION_ERROR</code> — e.g. <code>limit=0</code> or a
              malformed <code>cursor</code>; the body includes a{" "}
              <code>details</code> object with per-field messages.
            </li>
            <li>
              <code>429 RATE_LIMITED</code> — see Rate limits above.
            </li>
          </ul>
        </Section>

        <Section id="not-built" title="Not yet built">
          <p>
            No official SDK yet — the REST API and MCP tools above are
            sufficient to integrate directly. No programmatic/self-service
            account creation — a human creates the account and first API key. No
            batch/multi-URL lookup — call <code>?endpoint_url=</code> once per
            URL.
          </p>
        </Section>
      </div>
    </div>
  );
}
