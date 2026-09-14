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

**Production URL:** `https://agenttrust-umber.vercel.app`

---

## Onboarding flow (~5–10 minutes)

```
Sign up
  → create API key
  → register agent
  → configure endpoint
  → (optional) verify endpoint ownership
  → allow monitoring (activate the agent)
  → retrieve the agent by endpoint URL
  → request its trust decision
```

### 1. Sign up

Go to `https://agenttrust-umber.vercel.app/signup` and create an account
with email + password. Email confirmation is required — check your inbox
before continuing. There is currently no unauthenticated or
programmatic account-creation API; this one step is manual.

### 2. Create an API key

Dashboard → **API keys** → **Create key**.

The raw key is shown **exactly once**, at creation. Copy it immediately —
AgentTrust stores only a hash and can never show it to you again. If you
lose it, revoke it and create a new one. Every request below uses it as:

```
Authorization: Bearer <API_KEY>
```

### 3. Register an agent

Dashboard → **Agents** → **Register agent**. Fields:

| Field | Notes |
|---|---|
| `name` | Required. |
| `description` | Optional. |
| `endpointUrl` | Required. Must be `https://`. This is the URL other callers will look you up by. |
| `version` | Optional, e.g. `1.0.0`. |
| `authType` | `none`, `api_key`, `bearer`, `oauth2`, or `custom` — how AgentTrust's monitor authenticates to *your* endpoint (not how callers authenticate to AgentTrust). |
| `authCredential` / `authHeaderName` | Only if `authType` needs one. Stored encrypted (AES-256-GCM), never shown back in plaintext, never exposed in any public or API response. |
| `capabilities` | Comma-separated tags, e.g. `chat, ticket-triage`. |

The agent is created as `draft` — not monitored, not publicly visible yet.

### 4. Configure the endpoint

This is just the `endpointUrl` (and, if your endpoint needs it,
`authType`/`authCredential`) from step 3 — nothing further to configure.
`endpointUrl` must be reachable over HTTPS and must not point at a
private/internal/localhost address (rejected at registration).

### 5. (Optional) Verify endpoint ownership

On the agent's dashboard page → **Endpoint ownership** → **Start
verification**. AgentTrust gives you a URL and a token:

- Publish a file at exactly that URL containing exactly that token.
- Click **Check now**.

Verification is a **trust signal, not a requirement** — see "Verified vs
unverified" below. The check is throttled to once per 60 seconds per
agent; a repeated click within that window returns
`"Checking too often — try again in Ns."`.

### 6. Allow monitoring (activate)

While the agent is a draft, its dashboard page shows **Activate agent**.
Click it. This makes the agent public and puts it on the monitoring
schedule. Monitoring runs two ways:

- **Pull** (default): AgentTrust calls your `endpointUrl` on a cron.
  On the current plan this cron runs **once per day**, so a brand-new
  pull-mode agent's first reliability score can take several days to
  appear (see "Errors and fixes" below).
- **Push**: your agent calls `POST /api/v1/agents/{slug}/heartbeat`
  (owner-only, needs your API key) whenever it's alive. This is the
  faster path to a first score if you want to see one in this session.

### 7. Retrieve the agent by endpoint URL

This is the actual integration point — the thing any other AI agent does
to check you out before calling you:

```bash
curl -s "https://agenttrust-umber.vercel.app/api/v1/agents?endpoint_url=https%3A%2F%2Fyour-agent.example.com%2Fv1%2Finvoke" \
  -H "Authorization: Bearer <API_KEY>"
```

Matching is **exact** (after normalizing trailing slash and
scheme/host casing only) against the `endpointUrl` you registered. An
unregistered URL returns `200` with an empty `data` array — never an
error.

### 8. Request its trust decision

The lookup response above already includes `trustDecision` — there's no
separate call. See the example and field meanings below.

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
}
```

Other endpoints you'll likely also use:

- `GET /api/v1/agents/{slug}` — same enriched shape, by AgentTrust slug.
- `GET /api/v1/agents/{slug}/health` — `{agentId, slug, status, lastCheckedAt, latencyMs, httpStatus, checkStatus, reliabilityScore, reliabilityScoreComputedAt}`
- `POST /api/v1/agents/{slug}/heartbeat` — owner-only push liveness signal.
- MCP: `https://agenttrust-umber.vercel.app/api/mcp` (`list_agents`,
  `get_agent`, `get_agent_health`, `send_heartbeat` — same auth, same
  data, as tools).

Full reference: [`/docs`](https://agenttrust-umber.vercel.app/docs) and
its plain-text twin, `/llms.txt`.

---

## Reliability score

A deterministic 0–100 score computed from an agent's own trailing 7-day
check history — uptime, latency, consistency, and incidents, with an
uptime floor so a mostly-down agent can't buy back a good score through
other factors. It requires **at least 5 samples** before it's computed at
all; until then it's `null` (never a fabricated number). There is no
AI/LLM involved in scoring — same inputs always produce the same score.

## trustDecision

Derived entirely from an agent's **existing** status, reliability score,
and verification state — never a second, independent score.

- **`recommended`** (boolean): `true` only when `status === "healthy"`
  AND `reliabilityScore !== null` AND `reliabilityScore >= 50`.
- **`confidence`**: `"insufficient_data"` if no score yet; otherwise
  `"low"` if unverified regardless of score; otherwise `"high"` (score
  ≥ 90), `"medium"` (score ≥ 50), or `"low"`.
- **`reasons`**: plain-language list of every factor counting against
  the agent — empty only when nothing did.

## Verified vs. unverified agents

`verified` (and `ownershipVerifiedAt`) reflects whether the owner has
proven control of the endpoint via the well-known-file challenge (step
5). **Verification is optional and is not a hard requirement for
`recommended`.** A strong, healthy, unverified agent can still be
`recommended: true` — verification instead raises `confidence` and its
absence is always spelled out explicitly in `reasons`. A caller that
wants a stricter policy (e.g. "only trust verified agents") can enforce
that itself by checking the raw `verified` field — AgentTrust doesn't
impose that policy for everyone.

## Common errors and how to fix them

| Response | Cause | Fix |
|---|---|---|
| `401 UNAUTHENTICATED` — "Missing API key..." | No `Authorization` header. | Add `Authorization: Bearer <API_KEY>`. |
| `401 UNAUTHENTICATED` — "Invalid, expired, or revoked API key." | Wrong, revoked, or malformed key. | Create a new key in the dashboard; a revoked key can never work again by design. |
| `429 RATE_LIMITED` (Public API) | More than 100 requests/60s on one key. | Back off using the `X-RateLimit-Reset`/`Retry-After` header. |
| `429 RATE_LIMITED` — "Checking too often..." (ownership check) | Clicked **Check now** twice within 60s. | Wait for the stated `retryAfterSeconds`. |
| `400 VALIDATION_ERROR` | Bad `limit`/`cursor`, or a malformed field. | Check the `details` object in the response for the specific field. |
| `endpoint_url` lookup returns empty `data: []` | URL doesn't exactly match what you registered (path casing, ports, and query strings are compared exactly, not normalized). | Re-check `endpointUrl` as registered; only trailing slash and scheme/host casing are normalized. |
| `reliabilityScore` stays `null` for days | Pull-mode monitoring cron runs once/day and needs 5 samples. | Switch to push-mode via `POST /agents/{slug}/heartbeat`, or wait ~5 days. |
| Agent not visible / lookup returns nothing at all | Agent is still `draft` — never activated. | Go to the agent's dashboard page and click **Activate agent**. |

## Never share

Never include real API keys, credentials, verification tokens, database
URLs, or other secrets in bug reports, feedback, or anywhere outside your
own environment variables.
