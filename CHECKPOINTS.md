# AgentTrust — Project Checkpoints

Durable, point-in-time records of major project-state milestones. Each
entry is a snapshot, not a living document — update by adding a new dated
entry above the previous one, not by editing history.

---

## FIRST EXTERNAL BETA READY — 2026-09-14

**Verdict: READY FOR FIRST EXTERNAL BETA.**

### What AgentTrust does

Trust infrastructure for AI agents. An agent registers an identity with
AgentTrust, gets continuously health-monitored, can optionally prove
ownership of its endpoint, and accumulates a deterministic reliability
score from real monitoring history. Any external AI agent or system can
look up another agent by the URL it's about to call and get back a
machine-readable trust decision — `recommended` / `confidence` / `reasons`
— before deciding whether to depend on it. Available via a versioned REST
API and an MCP server exposing the same capabilities as tools.

### Architecture

Next.js 16 (App Router) + TypeScript, Drizzle ORM (postgres-js in
production, embedded pglite in tests), Supabase (Auth + Postgres + RLS),
deployed on Vercel (hosting + Cron). Production URL:
`https://agenttrust-umber.vercel.app`. No external services beyond
Supabase/Vercel — no Redis/Upstash, no third-party error tracking, no
SDK, no billing system.

### Implemented MVP capabilities

**Authentication & API-key model.** Supabase email/password auth for
dashboard accounts (email confirmation required). API keys are
self-service (create/revoke entirely through the dashboard, no
admin/approval step), stored only as an HMAC-SHA256 hash + pepper — the
raw key is shown exactly once, at creation, and can never be retrieved
again. Revoked keys remain visible in the owner's dashboard for
audit/usage history but are functionally inert (cannot authenticate) —
this is intentional, not a bug. Every `/api/v1/*` request and MCP tool
call requires `Authorization: Bearer <API_KEY>` and is rate-limited at
100 requests / 60 seconds per key (fixed window), enforced through one
shared `withRateLimitedAuth` wrapper so no route can forget it.

**Agent registration.** Owner-scoped CRUD with SSRF-protected endpoint
URL validation (rejects private/internal/localhost targets) at
registration time. Agents start `draft` (unmonitored, not publicly
visible) and require an explicit owner action to become `active`.

**Health monitoring.** Two modes: pull (Vercel Cron, DNS-rebinding-safe
resolver, manual redirect-following with per-hop re-validation, bounded
timeouts) and push (heartbeat endpoint for agents that can't be polled
inbound). Cron runs once/day on the current Vercel plan — a real cadence
limit, not a defect (see Known non-blocking gaps).

**Deterministic reliability scoring.** Pure, side-effect-free formula
(`src/lib/reliability/scoring.ts`) blending uptime/latency/consistency/
incident subscores from an agent's own trailing 7-day check history,
with an uptime-floor dampener so a down agent can't buy back a
respectable score through other subscores. Requires ≥5 samples before
scoring at all (`null` otherwise, never a fabricated number). Formula is
versioned (`FORMULA_VERSION`) for safe future changes. No AI/LLM scoring
anywhere in the product.

**Trust decision API.** `computeTrustDecision` (`src/lib/reliability/
trust-decision.ts`) derives `{recommended, confidence, reasons}` purely
from an agent's existing status/score/verification state — never a
second, independent score. `recommended` requires `status === "healthy"`
and `score >= 50`; ownership verification is a **signal that raises
confidence, not a hard gate** — an unverified agent with strong
health/reliability can still be `recommended: true` (confirmed with a
real production example: an unverified, `score: 100`, healthy agent
returns `recommended: true, confidence: "low"`).

**Endpoint ownership verification.** Domain-control proof via a
well-known file challenge (`/.well-known/agenttrust-verification.txt`),
matching the ACME/Google-Search-Console convention. Reuses the exact
same SSRF-safe fetch machinery as health checks, plus a dedicated
response-size cap for reading the file body. Verification is optional
and does not gate agent activation or monitoring — it's a separate,
additive trust signal (`verified` / `ownershipVerifiedAt`).

**Agent discovery by endpoint URL.** `GET /api/v1/agents?endpoint_url=`
looks up a registered agent by exactly the URL a caller is about to
call — the entry point for the trust-check flow when a caller only has
a URL, not an AgentTrust slug. Exact match only; normalizes trailing
slash and scheme/host casing (never fuzzy). An unknown URL returns
`200` with an empty array, never an error. Enrichment (score, health,
`trustDecision`) is added only on this lookup path and the single-agent
detail path — deliberately **not** on the plain unfiltered listing, to
avoid an N+1 query pattern on a browse endpoint.

**MCP support.** Real `@modelcontextprotocol` SDK server at `/api/mcp`
(Streamable HTTP transport), not a custom shim. `list_agents`,
`get_agent`, `get_agent_health`, `send_heartbeat` — each backed by the
exact same handler as its REST equivalent, so the two surfaces can never
drift apart. `tools/list` works without a key; calling a tool requires
one.

**Public API / docs.** `/docs` (full human-readable reference) and
`/llms.txt` (plain-text equivalent for LLM context) cover the complete
external workflow, every endpoint with real request/response examples
(fictional values only), URL normalization, `trustDecision`
interpretation, error shapes, and MCP usage. Linked from the site-wide
nav and homepage.

**Ownership-verification rate limiting.** The one BLOCKER identified by
the pre-beta audit: `checkOwnershipVerificationAction` could previously
trigger unlimited outbound fetches to any caller-chosen HTTPS URL. Fixed
with a 60-second-per-agent cooldown, enforced via a single atomic
`UPDATE ... WHERE ownership_last_checked_at IS NULL OR < cutoff` (claimed
*before* the outbound fetch, kept regardless of success/failure — closes
both the bypass-via-failure and the concurrent-request race). Live-
verified in production: normal → throttled (`"Checking too often — try
again in 46s."`) → resumes after the window.

### Current production deployment state

- Live commit: `aa693da37608f2b32b9b200f266842d2685e4385`
  ("Rate-limit the ownership-verification 'check now' action")
- `local HEAD == origin/main`, confirmed via fresh fetch
- 525/525 tests passing, `tsc`/`eslint`/`next build` all clean
- Two real registered agents in production: `Support Bot`,
  `Anthropic Status` — both `active`, `healthy`, confirmed unchanged
  throughout this entire build-out
- One active owner API key; all disposable/smoke-test keys and agents
  created during development/verification were revoked/deleted and
  confirmed functionally inert — no test artifacts remain

### Important security constraints (established, not to be relaxed casually)

- Monitored-endpoint credentials: AES-256-GCM, dedicated
  `AGENT_CREDENTIAL_ENCRYPTION_KEY`, never reused from
  `API_KEY_HASH_PEPPER`/`CRON_SECRET`. Decrypted only immediately before
  the outbound monitoring request, never logged.
- Ownership-verification tokens are *not* secrets (meant to be published
  by the owner) but must never appear in any public-facing API/MCP
  response — enforced by an explicit whitelist serialization boundary
  (`toPublicAgentJson`), with regression tests planting fake values and
  asserting their absence.
- SSRF protections (DNS-rebinding-safe custom resolver, private-IP
  literal blocking, per-redirect-hop re-validation) are shared by health
  checks *and* ownership-verification fetches — one mechanism, not two.
- Every error response comes from one shared `AppError` taxonomy; raw
  exceptions/stack traces/connection strings are never echoed to a
  caller.
- No `DATABASE_URL`, `DIRECT_URL`, `CRON_SECRET`, encryption keys, or raw
  credentials have ever been printed to any log, response, or this
  conversation's output.

### Database migrations applied (production, in order)

`0000_medical_sunspot` (initial schema) → `0001_add_agent_auth_type` →
`0002_add_health_check_fields` → `0003_silky_sasquatch` (credential
encryption columns) → `0004_goofy_blacklash` (ownership verification
columns) → `0005_illegal_marvel_zombies` (ownership-check-throttle
column). All additive/nullable, no destructive changes, no backfills
required at any step.

### Known non-blocking gaps (deliberately deferred)

- No per-account agent cap or endpoint-URL uniqueness constraint
  (identity squatting still technically possible)
- Pull-mode cron runs once/day — a newly-registered pull-mode agent can
  take up to ~5 days to get its first reliability score; push-mode
  (heartbeat) sidesteps this
- No production error tracking/observability (no Sentry or equivalent)
- No CI/CD pipeline — deploy-before-migrate ordering is manual
  discipline, not automated; this already caused one brief production
  outage during development (self-corrected, no data loss)
- No terms of service / privacy policy / self-service account deletion

None of these were classified as blockers for a first, curated external
beta user — they matter more at open/public scale.

### Explicit guidance for future development

**Do not automatically build an SDK, a billing system, an advanced
dashboard, a custom domain, or a new/second scoring model before real
beta feedback demonstrates an actual need for them.** Every one of these
was evaluated during this build-out and explicitly deferred as
premature: the documented REST API + MCP tools are sufficient for
integration today, there is no pricing model to bill against, the
current dashboard fully covers the core workflow, the Vercel URL is
adequate for a beta, and the existing deterministic reliability score
has already been protected from duplication/drift multiple times. Adding
any of these without a demonstrated beta-driven need would be feature
accumulation, not product development.

---
