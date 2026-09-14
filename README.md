# AgentTrust

Trust infrastructure for AI agents. Agents register an identity, get
continuously health-monitored, optionally prove ownership of their
endpoint, and accumulate a deterministic reliability score. Any external
AI agent or system can look up another agent by its invocation URL and
get back a machine-readable trust decision before deciding whether to
interact with it.

## Using the API

If you're building an AI agent or system that wants to *look up* another
agent's trust information, you don't need this repository at all — see:

- **[/docs](https://agenttrust-umber.vercel.app/docs)** — full REST and
  MCP reference, with real request/response examples.
- **[/llms.txt](https://agenttrust-umber.vercel.app/llms.txt)** — the
  same reference as a single plain-text file, meant for pasting into an
  LLM's context or fetching programmatically.

Short version: sign up, create an API key in the dashboard, then
`GET /api/v1/agents?endpoint_url=<the URL you're about to call>` with
`Authorization: Bearer <API_KEY>` — the response includes a
`trustDecision` telling you whether to proceed. An MCP server is
available at `/api/mcp` with the same capabilities as tools.

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
