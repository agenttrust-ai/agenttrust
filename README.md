# AgentTrust — Pre-invocation Trust Check for AI Agent Endpoints

Check an AI agent or MCP server endpoint before you call it. Given the exact
endpoint URL, AgentTrust returns the reliability evidence it has already
collected, endpoint-ownership verification, and a machine-readable
`trustDecision` — without contacting the endpoint.

**No AgentTrust account or API key required · Read-only · MCP and TypeScript SDK**

AgentTrust is trust infrastructure for AI agents. It provides
reliability monitoring, endpoint verification, and pre-invocation trust
checks for MCP and A2A agents. An agent registers an identity, gets
health-checked once a day, optionally proves ownership of its
endpoint, and accumulates a deterministic reliability score from that
observed history. Any external AI agent or system can look up another
agent by its invocation URL and get back a machine-readable
`trustDecision` — a signal derived from AgentTrust's own observed and
verified data, for the caller to weigh, never a certification or
guarantee of safety — before deciding whether to interact with it.

Official MCP Registry identity: `io.github.agenttrust-ai/agenttrust`.

## Quick start — no account needed

Every example below checks AgentTrust's own monitored test agent,
`https://agenttrust-umber.vercel.app/api/test-agent`; swap in the URL you're
about to call.

### MCP

Add the public connector `https://getagenttrust.com/api/mcp/public`
(Streamable HTTP, no authentication; two read-only tools, `check_agent_trust`
and `assess_agent`).
In Claude Code:

```bash
claude mcp add --transport http agenttrust https://getagenttrust.com/api/mcp/public
```

Claude Desktop, Cursor and a plain `curl` call:
[Connect an MCP client](https://getagenttrust.com/docs#mcp-clients).

### TypeScript SDK

```bash
npm install @getagenttrust/sdk
```

```ts
import { checkAgentTrust } from "@getagenttrust/sdk";

// AgentTrust's own test agent: a real, monitored endpoint you can check.
const result = await checkAgentTrust("https://agenttrust-umber.vercel.app/api/test-agent");

if (result.matched) {
  console.log(result.status, result.reliabilityScore, result.trustDecision);
  // e.g. "healthy" 100 { recommended: true, confidence: "high", reasons: [] }
} else {
  // AgentTrust has no data for this endpoint (yet). An unmatched result never
  // carries a score; result.observation may say it was queued for a lookup.
  console.log("Unknown endpoint", result.observation?.status);
}
```

Policies (`assertTrusted`), errors and options: [SDK README](packages/sdk/README.md)
· [npm](https://www.npmjs.com/package/@getagenttrust/sdk). New to AgentTrust?
Start with [First 5 minutes](#first-5-minutes).

### In the browser

[Check the test agent](https://getagenttrust.com/check-agent-trust?endpointUrl=https%3A%2F%2Fagenttrust-umber.vercel.app%2Fapi%2Ftest-agent)
on getagenttrust.com.

## First 5 minutes

No account or API key. Node.js 18 or later.

**1. Install.** `assessAgent` needs SDK 0.2.0 or later.

```bash
npm install @getagenttrust/sdk@^0.2.0
```

**2. Check an endpoint.** This checks AgentTrust's own monitored test agent,
so it returns a real result. The check is read-only, and AgentTrust never
contacts the endpoint you ask about.

```ts
import { assessAgent } from "@getagenttrust/sdk";

// AgentTrust's own monitored test agent. Swap in the URL your agent is about to call.
const assessment = await assessAgent("https://agenttrust-umber.vercel.app/api/test-agent");

console.log(assessment.decision, assessment.confidence, assessment.reasonCodes);
// e.g. allow_with_caution high ["OWNERSHIP_VERIFIED", "REACHABLE_AT_LAST_CHECK", …]

if (assessment.decision === "allow_with_caution") {
  // Reachable and not failing in AgentTrust's observations. Not proof that the
  // agent behaves safely: keep your own safeguards when you call it.
} else {
  // "avoid", or "insufficient_evidence" — also the answer for a URL AgentTrust
  // doesn't monitor (matched: false, reasonCodes includes "UNKNOWN_ENDPOINT").
  console.log("Not calling it:", assessment.limitations);
}
```

**3. Read the answer.** `confidence`, `reasonCodes` and `limitations` say why.

| `decision` | What it means | What to do |
|---|---|---|
| `allow_with_caution` | AgentTrust's observations show the endpoint reachable and not failing: a current historical reliability score, or at least two successful observations at least 10 minutes apart. | Call it, with your own safeguards. It isn't proof that the agent behaves safely. |
| `avoid` | AgentTrust's observations show it failing — for example two or more consecutive failures, or a current reliability score below 50. | Don't call it. |
| `insufficient_evidence` | Not enough evidence either way: an endpoint AgentTrust doesn't monitor, too few or too old observations, or a single failure that may be temporary. | Don't treat it as approval — handle it as an unknown endpoint. |

### Which call should I use?

| Call | Use it when | You get |
|---|---|---|
| `assessAgent(url)` | Your agent needs one decision to act on before it calls an endpoint. | `decision`, `confidence`, `reasonCodes` and `limitations`, with the evidence behind them. |
| `checkAgentTrust(url)` | You want the evidence itself — `status`, `reliabilityScore`, `verified` and `trustDecision` — to apply your own rules. | `{ matched: true, … }`, or `{ matched: false }` for an endpoint AgentTrust doesn't monitor. |
| `assertTrusted(url, policy)` | You want a gate: go ahead only if the endpoint meets your policy. | The `checkAgentTrust` result, or a thrown `NotTrustedError`. |

All three are anonymous and read-only, and never contact the endpoint (over MCP: `assess_agent` and `check_agent_trust`). They report what AgentTrust has observed; they don't certify an endpoint's security.

### Unknown endpoints are an answer, not an error

AgentTrust only has evidence for endpoints it monitors, so your first check of a real URL may come back unknown. That is an answer, not an API failure — the call succeeds:

- `assessAgent` returns `matched: false`, `decision: "insufficient_evidence"`, `confidence: "none"`, and `reasonCodes` including `"UNKNOWN_ENDPOINT"`.
- `checkAgentTrust` returns `{ matched: false }`, sometimes with an `observation` status when AgentTrust has queued the URL for a lookup in the official MCP Registry.
- `assertTrusted` throws `NotTrustedError` ("AgentTrust has no data for this endpoint") unless you pass `allowUnknown: true`.

Real failures — `RATE_LIMITED`, `TIMEOUT`, `NETWORK_ERROR` and the rest — throw an `AgentTrustError` instead.

Handle an unknown endpoint as not trusted: don't map `insufficient_evidence` to "allow", keep `allowUnknown: false` (the default) unless you have chosen otherwise on purpose, and ask a human or run your own checks before calling an endpoint nobody has observed.

### Next steps

- **Gate a real connection:** [`examples/check-before-connect.ts`](https://github.com/agenttrust-ai/agenttrust/blob/main/packages/sdk/examples/check-before-connect.ts)
  puts `assertTrusted` in front of an MCP client connection.
- **Tune the gate:** `minConfidence`, `requireVerified` and `minReliabilityScore`
  in the `assertTrusted` policy — see the [SDK README](packages/sdk/README.md).
- **Running an agent yourself?** Register it so other agents can check it — that
  needs an account and an API key: [Getting started](https://getagenttrust.com/docs#getting-started).

## Public checks vs. agent management

| | Public trust checks | Agent management |
|---|---|---|
| For | Checking any endpoint before you call it | Registering and monitoring your own agents; full agent records |
| Account / API key | Not needed | Account and API key (`Authorization: Bearer <API_KEY>`) |
| Interfaces | MCP `check_agent_trust` and `assess_agent` at `/api/mcp/public`; `@getagenttrust/sdk` (`checkAgentTrust`, `assertTrusted`, `assessAgent`) | REST `/api/v1/*`; MCP server `/api/mcp` (`list_agents`, `get_agent`, `get_agent_health`, `send_heartbeat`) |

To register an agent: sign up, create a key under Dashboard → API keys, then
follow [Getting started (REST)](https://getagenttrust.com/docs#getting-started).

## Documentation

You don't need this repository to use AgentTrust:

- **[/docs](https://getagenttrust.com/docs)** — full REST, MCP and SDK reference.
- **[/llms.txt](https://getagenttrust.com/llms.txt)** — the same reference as one
  plain-text file, for an LLM's context.

## Developing this project

This is a Next.js (App Router) + Drizzle + Supabase app, deployed on
Vercel.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You'll need a
`.env.local` — see `.env.example` for the required variables (Supabase
credentials, database connection strings, and the server-only secrets
described inline).

Useful scripts:

```bash
npm run test        # vitest — full suite runs against an embedded pglite DB, no live database needed
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run db:generate   # generate a new Drizzle migration from schema changes (offline)
npm run db:migrate    # apply pending migrations to the database in DIRECT_URL
```
