# AgentTrust — First Beta Onboarding

## What is AgentTrust?

AgentTrust is trust infrastructure for AI agents. You register an agent's
endpoint, AgentTrust monitors it and computes a deterministic reliability
score from real uptime/latency history, and any other AI agent or system
can look that agent up by the URL it's about to call and get back a
machine-readable trust decision — `recommended`, `confidence`, and
`reasons` — before deciding whether to depend on it.

**Who it's for:** developers building AI agents (or systems that call
other agents) who want a shared, independent signal for "should I trust
this endpoint" instead of every caller inventing its own ad hoc health
check.

**Problem it solves:** there's currently no shared way for one AI agent
to check whether another agent's endpoint is healthy, reliable, and
actually controlled by who it claims to be, before calling it.

**Production URL:** `https://getagenttrust.com`

---

## Two ways to use AgentTrust

- **Check an endpoint before you call it — no account or API key.** The
  public MCP connector, the TypeScript SDK, or the browser. See
  "Checking an agent without an API key" below.
- **Register and monitor your own agent** — needs an account and an API
  key. That's the walkthrough that follows.

## Onboarding flow

```
Sign up
  → create API key
  → register agent (endpoint URL, optional monitor credentials)
  → (optional) verify endpoint ownership
  → activate the agent (it becomes public and monitored)
  → look it up by endpoint URL → trustDecision
  → wait for monitoring: status after the next daily check,
    a reliability score after about five days
```

Account to an activated, discoverable agent takes about 10 minutes. The
trust decision only becomes meaningful once monitoring has run — see
"Timeline after you activate".

### 1. Sign up

Go to `https://getagenttrust.com/signup` and create an account with email
+ password. Email confirmation is required — check your inbox before
continuing. There is no programmatic account-creation API; this one step
is manual.

### 2. Create an API key

Dashboard → **API keys** → **Create key**.

The raw key is shown **exactly once**, at creation. Copy it immediately —
AgentTrust stores only a hash and can never show it to you again. If you
lose it, revoke it and create a new one. Every authenticated request below
uses it as:

```
Authorization: Bearer <API_KEY>
```

### 3. Register an agent

Dashboard → **Agents** → **Register agent**. Fields:

| Field | Notes |
|---|---|
| `name` | Required, 2–100 characters. |
| `description` | Optional. |
| `endpointUrl` | Required. Must be `https://`, and must not point at a private, internal or localhost address (rejected at registration). This is the exact URL other callers will look you up by. |
| `version` | Optional, e.g. `1.0.0`. |
| `authType` | `none`, `bearer` or `api_key` — how AgentTrust's monitor authenticates to *your* endpoint (not how callers authenticate to AgentTrust). |
| `authCredential` | Only for `bearer` or `api_key`. Stored encrypted (AES-256-GCM), never shown back in plaintext, never exposed in any public or API response. |
| `authHeaderName` | Only for `api_key`. Defaults to `X-API-Key`. |
| `capabilities` | Comma-separated tags, e.g. `chat, ticket-triage`. |
| Agent card fields | Optional: modalities, interaction type, documentation URL. |

With `bearer`, the monitor sends `Authorization: Bearer <credential>`;
with `api_key`, it sends `<authHeaderName>: <credential>`.

The agent is created as `draft` — not monitored, not publicly visible yet.

### 4. (Optional) Verify endpoint ownership

On the agent's dashboard page → **Endpoint ownership** → **Start
verification**. AgentTrust gives you a token and the URL to publish it
at — always `/.well-known/agenttrust-verification.txt` on your endpoint's
origin (scheme, host and port), not on the endpoint's own path.

- Publish a file at exactly that URL containing the token (surrounding
  whitespace is ignored). A redirect is followed only within the same
  origin.
- Click **Check now**.

Verification is a **trust signal, not a requirement** — see "Verified vs.
unverified agents" below. The check is throttled to once per 60 seconds per
agent; a repeated click within that window returns
`"Checking too often — try again in Ns."`.

### 5. Activate the agent

While the agent is a draft, its dashboard page shows **Activate agent**.
Click it. This makes the agent public and puts it on the monitoring
schedule.

Monitoring is **pull-based**: AgentTrust's own scheduled health checks are
the only thing that sets an agent's status and reliability score. There is
no push mode to switch to. `POST /api/v1/agents/{slug}/heartbeat` (and the
MCP `send_heartbeat` tool) still exist and are accepted, but for your
agent they only update `lastHeartbeatAt` — they don't change status or
score, and they don't speed up a first score.

### 6. Look the agent up by endpoint URL

This is the integration point — the thing any other AI agent does to check
you out before calling you. With an API key, over REST:

```bash
curl -s "https://getagenttrust.com/api/v1/agents?endpoint_url=https%3A%2F%2Fyour-agent.example.com%2Fv1%2Finvoke" \
  -H "Authorization: Bearer <API_KEY>"
```

Matching is **exact** against the `endpointUrl` you registered, after
standard URL parsing plus one rule — see "URL matching" below. An
unregistered URL returns `200` with an empty `data` array — never an error.

The response already includes `trustDecision` — there's no separate call.

---

## Timeline after you activate

| When | What you'll see |
|---|---|
| Right after activation | The lookup finds the agent with `status: "unknown"`, `reliabilityScore: null`, `reliabilityScoreStatus: "none"`, and `trustDecision` `{ recommended: false, confidence: "insufficient_data" }`. That's expected — nothing has been checked yet. |
| Next daily check, 00:00 UTC (09:00 KST) | The first health check runs. `status` becomes `healthy` if it succeeded, `degraded` if it failed. Activating doesn't trigger an immediate check. |
| Fifth daily check (about 4–5 days after activation) | A reliability score needs at least 5 checks in its trailing 7-day window, so this is when the first `reliabilityScore` appears. Until then it's `null` — never a placeholder number. |
| Afterwards | The score is recomputed after every check. A score older than 50 hours is `stale` and counts as no score in `trustDecision` (this only happens if checks stop running). |

## What the health check does

Useful when your agent shows `degraded` or `down` and you're not sure why.

- **Request:** a `GET` to your exact `endpointUrl`, with your monitor
  credential header if you set one, and the User-Agent
  `AgentTrust-HealthCheck/1.0 (+https://getagenttrust.com)` (allowlist it if
  your firewall filters bots). The response body is never read.
- **Limits:** 5-second connect and 10-second total timeout. Up to 5
  redirects are followed; every hop is re-checked, and a redirect to a
  private, internal or localhost address is blocked.
- **Retries:** a timeout, DNS error or connection error is retried within
  the same run, up to 3 attempts. An HTTP response is never retried.
- **What counts as up:** any 2xx or 3xx, and also **401, 403, 405 and 406**
  — the endpoint is reachable even if it rejected this particular request.
  MCP servers that answer a plain `GET` with 405 or 406 are fine.
- **What counts as a failure:** every other 4xx (including 400 and 404),
  every 5xx, timeouts, DNS/connection/TLS errors, and blocked redirects.
- **Status changes after a run of results, never a single sample:** 2
  consecutive failures → `degraded`, 4 → `down`, 2 consecutive successes →
  `healthy`. The very first check sets the status directly.

---

## Example request and response

Request:

```
GET /api/v1/agents?endpoint_url=https%3A%2F%2Fapi.example-acme.com%2Fv1%2Finvoke
Authorization: Bearer <API_KEY>
```

Response (`200`, fictional values):

```json
{
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
}
```

Other endpoints you'll likely also use (all need your API key):

- `GET /api/v1/agents/{slug}` — same enriched shape, by AgentTrust slug.
- `GET /api/v1/agents/{slug}/health` — `{agentId, slug, status, lastCheckedAt, latencyMs, httpStatus, checkStatus, reliabilityScore, reliabilityScoreStatus, reliabilityScoreComputedAt}`
- `POST /api/v1/agents/{slug}/heartbeat` — owner-only; for your agent it
  only updates `lastHeartbeatAt` (see step 5).
- MCP with an API key: `https://getagenttrust.com/api/mcp` (`list_agents`,
  `get_agent`, `get_agent_health`, `send_heartbeat`, plus
  `check_agent_trust`).

Full reference: [`/docs`](https://getagenttrust.com/docs) and its
plain-text twin, [`/llms.txt`](https://getagenttrust.com/llms.txt).

## Checking an agent without an API key

Any caller can run the same trust check anonymously and read-only — it
only reads AgentTrust's existing data and never contacts the endpoint being
checked. Anonymous checks are rate-limited per IP.

- **MCP:** the public connector `https://getagenttrust.com/api/mcp/public`
  (Streamable HTTP, no authentication; read-only tools `check_agent_trust`
  and `assess_agent`, a use-or-avoid decision). In
  Claude Code:

  ```bash
  claude mcp add --transport http agenttrust https://getagenttrust.com/api/mcp/public
  ```

  Other clients: [Connect an MCP client](https://getagenttrust.com/docs#mcp-clients).
- **TypeScript SDK:** `npm install @getagenttrust/sdk`, then
  `checkAgentTrust(endpointUrl)`; `assertTrusted(endpointUrl, policy)`
  throws unless the endpoint meets your policy. Node.js 18 or later. See the
  [SDK README](packages/sdk/README.md).
- **Browser:** `https://getagenttrust.com/check-agent-trust`.

To try any of these on a real, monitored agent, use AgentTrust's own test
agent: `https://agenttrust-umber.vercel.app/api/test-agent`.

---

## Reliability score

A deterministic 0–100 score computed from an agent's own trailing 7-day
check history — uptime, latency, consistency, and incidents, with an
uptime floor so a mostly-down agent can't buy back a good score through
other factors. It requires **at least 5 checks** in that window before it's
computed at all; until then it's `null` (never a fabricated number). There
is no AI/LLM involved in scoring — same inputs always produce the same
score.

`reliabilityScoreStatus` tells you whether the score is current: `none`
(no score yet), `fresh`, or `stale` (older than 50 hours).

## trustDecision

Derived entirely from an agent's **existing** status, reliability score,
score freshness and verification state — never a second, independent score.

- **`recommended`** (boolean): `true` only when `status === "healthy"` AND
  there is a **fresh** `reliabilityScore` AND it is ≥ 50.
- **`confidence`**: `"insufficient_data"` if there's no fresh score;
  otherwise `"low"` if unverified, regardless of score; otherwise `"high"`
  (score ≥ 90), `"medium"` (score ≥ 50), or `"low"`.
- **`reasons`**: plain-language list of every factor counting against
  the agent — empty only when nothing did.

Details: [Interpreting trustDecision](https://getagenttrust.com/docs#trust-decision).

## Verified vs. unverified agents

`verified` (and `ownershipVerifiedAt`) reflects whether the owner has
proven control of the endpoint's origin via the well-known-file challenge
(step 4). **Verification is optional and is not a hard requirement for
`recommended`.** A strong, healthy, unverified agent can still be
`recommended: true` — verification instead raises `confidence` and its
absence is always spelled out explicitly in `reasons`. A caller that
wants a stricter policy (e.g. "only trust verified agents") can enforce
that itself by checking the raw `verified` field — AgentTrust doesn't
impose that policy for everyone.

## URL matching

Exact match only — never fuzzy or partial. Both the URL you pass and each
registered URL go through standard URL parsing, plus one extra rule:

- a trailing slash on a non-root path is ignored (`.../invoke/` matches
  `.../invoke`);
- scheme/host casing and default ports are normalized by URL parsing
  (`HTTPS://Example.com:443/a` matches `https://example.com/a`).

Path casing, query strings, fragments and non-default ports are compared
exactly. Details: [URL normalization](https://getagenttrust.com/docs#normalization).

## Common errors and how to fix them

| Response | Cause | Fix |
|---|---|---|
| `401 UNAUTHENTICATED` — "Missing API key..." | No `Authorization` header. | Add `Authorization: Bearer <API_KEY>`. |
| `401 UNAUTHENTICATED` — "Invalid, expired, or revoked API key." | Wrong, revoked, or malformed key. | Create a new key in the dashboard; a revoked key can never work again by design. |
| `429 RATE_LIMITED` (REST API) | More than 100 requests/60s on one key. | Back off using the `Retry-After` header. |
| `429 RATE_LIMITED` — "Checking too often..." (ownership check) | Clicked **Check now** twice within 60s. | Wait for the stated `retryAfterSeconds`. |
| `400 VALIDATION_ERROR` | Bad `limit`/`cursor`, or a malformed field. | Check the `details` object in the response for the specific field. |
| `endpoint_url` lookup returns empty `data: []` | URL doesn't exactly match what you registered (path casing, query strings and non-default ports are compared exactly). | Re-check `endpointUrl` as registered — see "URL matching". |
| Agent not found at all | Agent is still `draft` — never activated. | Go to the agent's dashboard page and click **Activate agent**. |
| `status` stays `unknown` | No health check has run yet. | Wait for the next daily check at 00:00 UTC. |
| `reliabilityScore` stays `null` | Fewer than 5 checks so far. | Expected for about 4–5 days after activation. Heartbeats don't speed this up. |
| `status` is `degraded` or `down` | Health checks are failing. | See "What the health check does": a 400, 404 or 5xx, a timeout, or a TLS error counts as a failure. |

## Never share

Never include real API keys, credentials, verification tokens, database
URLs, or other secrets in bug reports, feedback, or anywhere outside your
own environment variables.
