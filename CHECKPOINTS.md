# AgentTrust — Project Checkpoints

Durable, point-in-time records of major project-state milestones. Each
entry is a snapshot, not a living document — update by adding a new dated
entry above the previous one, not by editing history.

---

## FUNCTION REGION MOVE iad1 → sin1 (MONITORING-ORIGIN CHANGE) — 2026-09-26

**What changed.** `vercel.json` now sets `"regions": ["sin1"]`, so every
Vercel Function — pages, the Public API, `/api/mcp`, and both cron jobs —
runs in Singapore (`sin1`, AWS ap-southeast-1), the same region as the
Supabase production database. Previously everything ran in the default
`iad1` (Washington, D.C.). The Hobby plan allows exactly one function
region, so the API cannot move without monitoring moving too.

**Why.** A 2026-09-26 read-only latency audit found `check_agent_trust`
making ~14 sequential database round trips from `iad1` to Singapore
(~250 ms each): median ~3.8 s end to end, of which under 10 ms was actual
database execution.

**Effective:** from the first production deployment of the commit that adds
this entry (its Vercel/GitHub production deployment timestamp is the exact
cut-over), deployed outside the cron windows (monitoring fires ~00:44 UTC,
discovery ~04:25 UTC).

**Methodology change — monitoring origin.** Health checks, ownership
verification fetches, and registry discovery fetches now originate from
Singapore instead of Washington, D.C. A health check's `latencyMs` covers
DNS + TCP + TLS + request on a fresh connection, so it depends on the
distance between the prober and the agent's endpoint.
- **`health_checks` rows do not record a monitoring origin.** Rows before
  the cut-over were probed from `iad1`, rows after it from `sin1`; the only
  way to tell them apart is `checked_at` relative to the cut-over.
- **For ~7 days after the move (`SCORE_WINDOW_DAYS`), reliability-score
  windows contain a mix of `iad1` and `sin1` latency samples.** After that,
  every window is `sin1`-only.
- The scoring formula is unchanged (`formula_version` stays `v1`); only the
  vantage point of the latency input changed. Success/failure, status
  derivation, timeouts (5 s connect / 10 s total), retries, cron schedules,
  rate limits, and every API/MCP contract are unchanged.

**Expected impact (modeled before the move from 2026-09-26 production
data, not measured from `sin1`).** Latency only affects the score when an
agent's 7-day average exceeds 500 ms (then −1 point per ~225 ms, at most
20 points). Estimated per-agent change for the 19 scored agents: about +0.1
to −2.4 points; no agent crosses the 50 (recommended) or 90 thresholds.
Asia-hosted endpoints improve; endpoints served directly from US/EU origins
worsen most; edge-hosted endpoints (Cloudflare, Vercel, Google front end)
change little. Timeout headroom is large (slowest successful check in the
prior 7 days: 1,394 ms).

**Rollback.** Remove `"regions"` from `vercel.json` (or set it to
`["iad1"]`) and redeploy. No data migration either way; rows written while
in `sin1` stay as they are, also without origin metadata — record the
rollback time here as a new entry.

**Status of the entry below:** migration 0008 was applied to production and
backfilled on 2026-09-26 (72/72 rows), and `36dbae4` (indexed endpoint
lookup) was deployed and reconciled the same day.

---

## ENDPOINT LOOKUP INDEX — MIGRATION 0008 PENDING — 2026-09-26

**State: implemented and tested locally; migration NOT yet applied to
production.** Until 0008 is applied, the code that depends on it must not
be deployed (see the ordering below).

**What changed.** The public endpoint-URL lookup (`check_agent_trust` and
`GET /api/v1/agents?endpoint_url=`, both via `listPublicAgents`) no
longer loads every public+active agent's URL and normalizes each one in
application code. It is now one indexed equality match on a new nullable
column, `agents.endpoint_url_normalized`, which always holds
`normalizeEndpointUrlForLookup(endpoint_url)` — computed by that same
function on every write (`createAgent`, `updateOwnedAgent`,
`insertExternallyObservedAgent`), never re-implemented in SQL. NULL never
matches. Matching semantics, multiple-match behavior and newest-first
ordering are unchanged; no API, MCP schema, trustDecision, discovery or
monitoring behavior changed. Endpoint URLs are still not unique (see the
known gap below).

**Migrations applied to production (verified read-only 2026-09-26):**
`0000` through `0007_red_crystal` — 8 total, matching the repo journal
(the 2026-09-14 list below predates `0006_long_bastion`, discovery
columns, and `0007_red_crystal`, anonymous rate limits).

**Pending:** `0008_add_endpoint_url_normalized` — `ADD COLUMN
endpoint_url_normalized text` (nullable, no default) and non-unique btree
index `agents_endpoint_url_normalized_idx`. Additive only.

**Required production rollout order** (no CI/CD — manual discipline):
1. `npm run db:migrate` against production *before* pushing the code.
   The previously deployed code ignores the new column.
2. `npx tsx --conditions=react-server --env-file=.env.local
   scripts/backfill-endpoint-url-normalized.ts` (dry run), then again
   with `--apply`. Idempotent; guarded per row on `endpoint_url` being
   unchanged; prints counts only.
3. Push; let Vercel deploy.
4. Immediately re-run the script with `--apply` to reconcile any row the
   old code wrote between steps 2 and 4 (until then such a row is not
   found by the lookup).
5. Verify read-only: dry run reports `outOfSync: 0`; known endpoints
   still match via `check_agent_trust`.

**Rollback:** revert the code commit only. Leave the column and index in
place — the old code ignores them and `endpoint_url` is never modified.

**If `normalizeEndpointUrlForLookup` ever changes,** the stored column
must be reconciled again (step 4's command) in every environment.

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
