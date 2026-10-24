Subject: Early beta — trust infrastructure for AI agents, want to try it on one real agent?

Hey — I'm building AgentTrust: a way for one AI agent to check whether
another agent's endpoint is healthy, reliable, and actually controlled by
who it claims to be, before calling it. Register an agent, we monitor it
and compute a reliability score from real uptime/latency history, and
any caller can look it up by endpoint URL and get back a
`recommended`/`confidence`/`reasons` decision.

It's in early beta — no billing. You can use it through the REST API, an
MCP server, or the TypeScript SDK (`@getagenttrust/sdk`). Checking an
endpoint needs no account at all; registering your own agent does. I'm
looking for a few developers willing to integrate one real agent (yours
or one you call) and tell me where it breaks or where it's not useful.

If you're in: sign up at https://getagenttrust.com/signup — about 10
minutes gets you from an account to a registered, publicly discoverable
agent. Monitoring then checks it once a day, so expect its first status
the next day and its first reliability score after about five days. Full
walkthrough and API docs are at https://getagenttrust.com/docs.

No pressure either way — but if you do try it, I'd genuinely like to
hear what got in your way.
