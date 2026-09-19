import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "API Reference — AgentTrust",
  description:
    "How to authenticate, look up an agent by endpoint URL, and interpret its trust decision — REST and MCP.",
};

function Code({ children }: { children: string }) {
  return (
    <pre className="mt-2 overflow-x-auto rounded-md border border-border bg-background p-3 font-mono text-xs">
      <code>{children}</code>
    </pre>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <div className="mt-3 flex flex-col gap-3 text-sm text-muted [&_strong]:text-foreground [&_code]:rounded [&_code]:bg-surface [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_code]:text-foreground">
        {children}
      </div>
    </section>
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

export default function DocsPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 py-16">
      <div>
        <p className="text-sm font-medium tracking-wide text-accent uppercase">
          API reference
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-balance">
          Use AgentTrust from another AI agent
        </h1>
        <p className="mt-3 max-w-xl text-muted">
          Everything below is also available as a plain-text file at{" "}
          <a href="/llms.txt" className="text-accent hover:underline">
            /llms.txt
          </a>{" "}
          — built for pasting into an LLM&apos;s context or reading
          programmatically. Base URL for every example on this page:{" "}
          <code className="rounded bg-surface px-1 py-0.5 font-mono text-xs text-foreground">
            https://getagenttrust.com
          </code>
        </p>
        <p className="mt-4 rounded-md border border-accent/30 bg-surface p-3 text-sm text-muted">
          <strong className="text-foreground">5-minute beta path:</strong>{" "}
          <a href="/signup" className="text-accent hover:underline">
            sign up
          </a>{" "}
          → Dashboard → API keys → Create key → Dashboard → Agents →
          Register agent → Activate agent →{" "}
          <a href="#getting-started" className="text-accent hover:underline">
            call <code>?endpoint_url=</code>
          </a>{" "}
          and read <code>trustDecision</code> from the response. Skip
          ownership verification for now — it&apos;s optional (see Step 5
          below).
        </p>
      </div>

      <Section id="getting-started" title="Getting started">
        <p>
          <strong>Step 1 — Create an account.</strong> Sign up at{" "}
          <code>/signup</code> with email + password; confirm your email
          before continuing. There&apos;s no programmatic/self-service
          account-creation API yet — this one step is manual.
        </p>
        <p>
          <strong>Step 2 — Create an API key.</strong> Dashboard → API
          keys → Create key. The raw key is shown <strong>exactly
          once</strong> — copy it immediately. Use it as{" "}
          <code>Authorization: Bearer YOUR_API_KEY</code> on every request
          below (see Authentication further down for error details).
        </p>
        <p>
          <strong>Step 3 — Register an agent.</strong> Dashboard → Agents
          → Register agent. Required: <code>name</code>,{" "}
          <code>endpointUrl</code> (must be <code>https://</code>).
          Optional: <code>description</code>, <code>version</code>,{" "}
          <code>authType</code> (<code>none</code> / <code>api_key</code>{" "}
          / <code>bearer</code> / <code>oauth2</code> / <code>custom</code>{" "}
          — how AgentTrust&apos;s monitor authenticates to{" "}
          <em>your</em> endpoint, with a credential stored encrypted and
          never exposed back), and <code>capabilities</code>
          (comma-separated tags). The agent starts as a private{" "}
          <code>draft</code> — not monitored, not publicly visible yet.
        </p>
        <p>
          <strong>Step 4 — Configure the agent endpoint.</strong> This is
          just the <code>endpointUrl</code> (and{" "}
          <code>authType</code>/credential, if your endpoint needs one)
          from Step 3 — it&apos;s the exact URL other callers will look
          you up by. It must be reachable over HTTPS and must not point at
          a private/internal/localhost address; registration rejects
          those.
        </p>
        <p>
          <strong>Step 5 — Endpoint ownership verification (optional).</strong>{" "}
          On the agent&apos;s dashboard page: Start verification → publish
          a file at the given URL containing the given token → Check now.
          This proves you control the endpoint, not just that something
          answers there.{" "}
          <strong>
            Verification is entirely optional and never gates{" "}
            <code>recommended</code>
          </strong>{" "}
          — an unverified agent with strong health/reliability history can
          still be <code>recommended: true</code>. Verification only
          raises <code>confidence</code>, and its absence always appears
          as one entry in <code>reasons</code> — it&apos;s a signal, not a
          hard requirement. Checks are throttled to one per 60 seconds per
          agent.
        </p>
        <p>
          <strong>Step 6 — Let monitoring collect health/reliability data.</strong>{" "}
          Click <strong>Activate agent</strong> on its dashboard page —
          this makes it public and puts it on the monitoring schedule.
          Pull-mode (default) checks run once per day via cron, and{" "}
          <code>reliabilityScore</code> stays <code>null</code> (shown as{" "}
          <strong>&quot;Not enough data yet&quot;</strong>) until at
          least 5 checks exist, which can take several days in pull mode.
          For a faster first score, send a heartbeat instead:{" "}
          <code>POST /api/v1/agents/{"{slug}"}/heartbeat</code>{" "}
          (owner-only, same Bearer auth).
        </p>
        <p>
          <strong>Step 7 — Discover an agent by endpoint URL.</strong>{" "}
          <code>GET /api/v1/agents?endpoint_url=&lt;url&gt;</code> — exact
          match against the <code>endpointUrl</code> you registered (only
          trailing slash and scheme/host casing are normalized — see
          Normalization below). An unregistered URL returns{" "}
          <code>200</code> with an empty <code>data</code> array, never an
          error.
        </p>
        <p>
          <strong>Step 8 — Request/read the trust decision.</strong> The
          Step 7 response already includes <code>trustDecision</code> —
          there&apos;s no separate call. See &quot;Interpreting
          trustDecision&quot; below for exactly what{" "}
          <code>recommended</code>/<code>confidence</code>/
          <code>reasons</code> mean.
        </p>
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
        <ol className="ml-5 list-decimal space-y-1">
          <li>
            Discover — this page, <code>/llms.txt</code>, or AgentTrust&apos;s
            own A2A Agent Card at{" "}
            <code>/.well-known/agent-card.json</code> (for A2A-capable
            agents/clients).
          </li>
          <li>
            Authenticate — a human creates an API key once, via the dashboard
            (see below). Use it as <code>Authorization: Bearer &lt;API_KEY&gt;</code>{" "}
            on every request, REST or MCP.
          </li>
          <li>
            Look up the agent by the URL you&apos;re about to call:{" "}
            <code>GET /api/v1/agents?endpoint_url=&lt;url&gt;</code>
          </li>
          <li>
            Receive trust information: reliability score, status,
            verification state, and the latest health check.
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
          key list — kept for audit/usage history — but can never
          authenticate again once revoked. That&apos;s intentional, not a
          bug.
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
          100 requests / 60 seconds, per API key, fixed window. Every
          response carries <code>X-RateLimit-Limit</code>,{" "}
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
          <code>reliabilityScore</code>, <code>reliabilityScoreComputedAt</code>,{" "}
          <code>lastCheckedAt</code>, <code>latencyMs</code>,{" "}
          <code>httpStatus</code>, and <code>trustDecision</code>. An
          unregistered URL returns <code>200</code> with an empty{" "}
          <code>data</code> array — never an error.
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
          <code>&quot;externally_observed&quot;</code>): how the agent
          entered AgentTrust. <code>owner_registered</code> means a human
          registered and activated it. <code>externally_observed</code>{" "}
          means AgentTrust discovered it from a public agent registry on
          nobody&apos;s behalf — it is always unclaimed and unverified,
          exactly like any other unverified agent; <code>source</code> is
          provenance, not a trust signal by itself.
        </p>
      </Section>

      <Section id="normalization" title="URL normalization">
        <p>
          Exact match only — never fuzzy or partial. Normalized for exactly
          two things before comparing:
        </p>
        <ol className="ml-5 list-decimal space-y-1">
          <li>
            A trailing slash on a non-root path (<code>.../invoke/</code>{" "}
            matches <code>.../invoke</code>).
          </li>
          <li>
            Scheme/host casing (<code>HTTPS://Example.com</code> matches{" "}
            <code>https://example.com</code>).
          </li>
        </ol>
        <p>
          Nothing else is normalized — path casing, query strings, and ports
          are compared exactly as given.
        </p>
      </Section>

      <Section id="trust-decision" title="Interpreting trustDecision">
        <p>
          Derived entirely from an agent&apos;s existing status, reliability
          score, and verification state — <strong>never a second,
          independent score</strong>.
        </p>
        <p>
          <code>recommended</code> (boolean): true only when{" "}
          <code>status === &quot;healthy&quot;</code> AND{" "}
          <code>reliabilityScore !== null</code> AND{" "}
          <code>reliabilityScore &gt;= 50</code>.
        </p>
        <p>
          <code>confidence</code> (<code>&quot;high&quot;</code> |{" "}
          <code>&quot;medium&quot;</code> | <code>&quot;low&quot;</code> |{" "}
          <code>&quot;insufficient_data&quot;</code>):
        </p>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <code>insufficient_data</code> if <code>reliabilityScore</code>{" "}
            is <code>null</code> (not enough monitoring history yet).
          </li>
          <li>otherwise <code>low</code> if the agent is unverified, regardless of score.</li>
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
        <p className="rounded-md border border-accent/30 bg-surface p-3">
          <strong>Verification is a trust signal, not a hard requirement.</strong>{" "}
          Ownership verification is optional and does not gate{" "}
          <code>recommended</code> — an unverified agent with strong
          health/reliability history can still be{" "}
          <code>recommended: true</code>. Verification instead affects{" "}
          <code>confidence</code>, and its absence is always spelled out
          explicitly in <code>reasons</code>, so a caller wanting a stricter
          policy (e.g. &quot;only trust verified agents&quot;) can enforce
          that themselves using the raw <code>verified</code> field —
          AgentTrust doesn&apos;t impose that policy for everyone.
        </p>
      </Section>

      <Section id="endpoints" title="Other endpoints">
        <p>
          <code>GET /api/v1/agents</code> — plain listing of public, active
          agents (no <code>endpoint_url</code>). Query params:{" "}
          <code>limit</code> (1-100, default 20), <code>cursor</code>{" "}
          (opaque, from a previous response&apos;s{" "}
          <code>pagination.nextCursor</code>). No trust-decision enrichment —
          only the base identity/verification fields.
        </p>
        <p>
          <code>GET /api/v1/agents/{"{slug}"}</code> — same enrichment as the
          endpoint_url lookup, for one agent by its AgentTrust slug.{" "}
          <code>404</code> if the slug doesn&apos;t exist or isn&apos;t
          public+active.
        </p>
        <p>
          <code>GET /api/v1/agents/{"{slug}"}/health</code> — <code>{"{agentId, slug, status, lastCheckedAt, latencyMs, httpStatus, checkStatus, reliabilityScore, reliabilityScoreComputedAt}"}</code>
        </p>
        <p>
          <code>POST /api/v1/agents/{"{slug}"}/heartbeat</code> — owner-only
          (the key must belong to that agent&apos;s own account); records a
          push-mode liveness signal. Reads no request body.{" "}
          <code>{"{slug, status, lastHeartbeatAt}"}</code>
        </p>
      </Section>

      <Section id="errors" title="Common errors">
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <code>401 UNAUTHENTICATED</code> — missing, invalid, expired, or
            revoked key.
          </li>
          <li>
            <code>404 NOT_FOUND</code> — unknown slug on{" "}
            <code>GET /agents/{"{slug}"}</code>. An unknown{" "}
            <code>endpoint_url</code> on the list endpoint is{" "}
            <strong>not</strong> an error — it&apos;s <code>200</code> with
            an empty <code>data</code> array.
          </li>
          <li>
            <code>400 VALIDATION_ERROR</code> — e.g. <code>limit=0</code> or
            a malformed <code>cursor</code>; the body includes a{" "}
            <code>details</code> object with per-field messages.
          </li>
          <li>
            <code>429 RATE_LIMITED</code> — see Rate limits above.
          </li>
        </ul>
      </Section>

      <Section id="mcp" title="MCP">
        <p>
          Endpoint: <code>https://getagenttrust.com/api/mcp</code>{" "}
          (GET and POST, Streamable HTTP transport). Auth: the same Bearer
          token as REST, in the <code>Authorization</code> header — except{" "}
          <code>check_agent_trust</code>, below, which needs none.{" "}
          <code>tools/list</code> works without a key; calling any other
          tool requires one (the same 401 as REST on a missing/bad key).
        </p>
        <p className="rounded-md border border-accent/30 bg-surface p-3">
          <strong className="text-foreground">
            <code>check_agent_trust({"{endpointUrl}"})</code>
          </strong>{" "}
          — the preferred check before invoking an unknown external agent.
          No API key or account required. Read-only, and never contacts{" "}
          <code>endpointUrl</code> itself — it only reads AgentTrust&apos;s
          own already-observed data. Returns{" "}
          <code>{"{ matched: false }"}</code> for an unregistered URL, or{" "}
          <code>
            {"{ matched: true, slug, name, status, verified, reliabilityScore, trustDecision }"}
          </code>{" "}
          for a known public+active agent. Anonymous calls are rate-limited
          per caller IP; a <code>429</code> carries{" "}
          <code>retryAfterSeconds</code>.
        </p>
        <p>Tools requiring an API key (each backed by the exact same handler as its REST equivalent):</p>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <code>list_agents({"{limit?, cursor?, endpointUrl?}"})</code> —{" "}
            <code>endpointUrl</code> triggers the same trust-check
            enrichment as the REST <code>?endpoint_url=</code> filter, plus
            the full public agent record (agent card, capabilities, etc.)
            that <code>check_agent_trust</code> deliberately omits.
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

      <Section id="not-built" title="Not yet built">
        <p>
          No official SDK yet — the REST API and MCP tools above are
          sufficient to integrate directly. No programmatic/self-service
          account creation — a human creates the account and first API key.
          No batch/multi-URL lookup — call <code>?endpoint_url=</code> once
          per URL.
        </p>
      </Section>
    </div>
  );
}
