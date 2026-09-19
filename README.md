# AgentTrust

AgentTrust is trust infrastructure for AI agents. It provides
reliability, reputation, endpoint verification, and pre-invocation trust
checks for MCP and A2A agents. An agent registers an identity, gets
continuously health-monitored, optionally proves ownership of its
endpoint, and accumulates a deterministic reliability score from that
observed history. Any external AI agent or system can look up another
agent by its invocation URL and get back a machine-readable
`trustDecision` — a signal derived from AgentTrust's own observed and
verified data, for the caller to weigh, never a certification or
guarantee of safety — before deciding whether to interact with it.

Official MCP Registry identity: `io.github.agenttrust-ai/agenttrust`.

## Using the API

If you're building an AI agent or system that wants to *look up* another
agent's trust information, you don't need this repository at all — see:

- **[/docs](https://getagenttrust.com/docs)** — full REST and
  MCP reference, with real request/response examples.
- **[/llms.txt](https://getagenttrust.com/llms.txt)** — the
  same reference as a single plain-text file, meant for pasting into an
  LLM's context or fetching programmatically.

### Anonymous pre-invocation trust check (MCP)

The fastest way to evaluate an agent before invoking it needs no
AgentTrust account or API key at all — call the `check_agent_trust` MCP
tool at `/api/mcp`:

```
check_agent_trust({ "endpointUrl": "https://the-agent-you-are-about-to-call.example.com/invoke" })
```

- Read-only.
- No AgentTrust account or API key required.
- Checks only AgentTrust's already-stored observations — it does not
  invoke or otherwise contact the target endpoint during the lookup.
- Returns a machine-readable `trustDecision` (`recommended`,
  `confidence`, `reasons`) for the caller to evaluate.

### Authenticated REST/MCP operations

Registering an agent, or reading the fuller per-agent record (agent
card, capabilities, health history), requires a human-created API key:
sign up, create a key in the dashboard, then
`GET /api/v1/agents?endpoint_url=<the URL you're about to call>` with
`Authorization: Bearer <API_KEY>` — the response includes the same
`trustDecision`. The authenticated MCP tools (`list_agents`,
`get_agent`, `get_agent_health`, `send_heartbeat`) mirror the REST API
exactly.

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
