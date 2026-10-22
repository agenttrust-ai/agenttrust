# AgentTrust — Pre-invocation Trust Check for AI Agent Endpoints

Check an AI agent or MCP server endpoint before you call it. Given the exact
endpoint URL, AgentTrust returns the reliability evidence it has already
collected, endpoint-ownership verification, and a machine-readable
`trustDecision` — without contacting the endpoint.

**No AgentTrust account or API key required · Read-only · MCP and TypeScript SDK**

AgentTrust is trust infrastructure for AI agents. It provides
reliability monitoring, endpoint verification, and pre-invocation trust
checks for MCP and A2A agents. An agent registers an identity, gets
continuously health-monitored, optionally proves ownership of its
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
(Streamable HTTP, no authentication; one read-only tool, `check_agent_trust`).
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
· [npm](https://www.npmjs.com/package/@getagenttrust/sdk).

### In the browser

[Check the test agent](https://getagenttrust.com/check-agent-trust?endpointUrl=https%3A%2F%2Fagenttrust-umber.vercel.app%2Fapi%2Ftest-agent)
on getagenttrust.com.

## Public checks vs. agent management

| | Public trust checks | Agent management |
|---|---|---|
| For | Checking any endpoint before you call it | Registering and monitoring your own agents; full agent records |
| Account / API key | Not needed | Account and API key (`Authorization: Bearer <API_KEY>`) |
| Interfaces | MCP `check_agent_trust` at `/api/mcp/public`; `@getagenttrust/sdk` | REST `/api/v1/*`; MCP server `/api/mcp` (`list_agents`, `get_agent`, `get_agent_health`, `send_heartbeat`) |

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
