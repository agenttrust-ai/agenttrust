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
            https://agenttrust-umber.vercel.app
          </code>
        </p>
      </div>

      <Section id="workflow" title="The workflow">
        <p>
          The thing AgentTrust is actually for: another AI agent has a URL
          it&apos;s about to call, and wants to know whether it should.
        </p>
        <ol className="ml-5 list-decimal space-y-1">
          <li>Discover — this page, or <code>/llms.txt</code>.</li>
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
          Endpoint: <code>https://agenttrust-umber.vercel.app/api/mcp</code>{" "}
          (GET and POST, Streamable HTTP transport). Auth: the same Bearer
          token as REST, in the <code>Authorization</code> header.{" "}
          <code>tools/list</code> works without a key; calling a tool
          requires one (the same 401 as REST on a missing/bad key).
        </p>
        <p>Tools — each backed by the exact same handler as its REST equivalent:</p>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <code>list_agents({"{limit?, cursor?, endpointUrl?}"})</code> —{" "}
            <code>endpointUrl</code> triggers the same trust-check
            enrichment as the REST <code>?endpoint_url=</code> filter.
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
