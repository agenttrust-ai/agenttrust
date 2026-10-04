# AgentTrust — Project Checkpoints

Durable, point-in-time records of major project-state milestones. Each
entry is a snapshot, not a living document — update by adding a new dated
entry above the previous one, not by editing history.

---

## /api/mcp TOOL WORDING ALIGNED WITH THE PUBLIC TOOL — 2026-10-04

**Why.** A read-only discovery audit found that the two third-party
listings still on `/api/mcp` showed its old copy: Glama (live, re-read
daily; disambiguation 2/5) and Smithery (a stored snapshot), both with
"The preferred …" and no annotations, and with `list_agents` overlapping
`check_agent_trust`. This is the change deferred in the entry below.

**What.** `969917f`, on `/api/mcp` (`src/lib/mcp/server.ts`):
- `check_agent_trust` description now opens "Pre-invocation trust check
  for an unknown AI agent or MCP server endpoint." instead of "The
  preferred pre-invocation trust check for an unknown external agent."; the
  rest is unchanged.
- `check_agent_trust` now carries the same annotations as
  `/api/mcp/public` (title, readOnlyHint true, destructiveHint false,
  idempotentHint true, openWorldHint false), from one shared constant.
- `list_agents` description adds: "Requires an API key; for an anonymous
  pre-invocation check use check_agent_trust."
- Pinned `tools-list.json` snapshot updated deliberately; the regression
  test now allows annotations only on `check_agent_trust`, and a new test
  pins the wording. 917/917 tests, typecheck, lint, build passed.

**Unchanged.** Tool names, input/output schemas, handlers, auth, rate
limits, serverInfo (1.0.4) and instructions (`initialize.json` snapshot
unchanged); the three key-only tools have no annotations;
`/api/mcp/public` unchanged. No MCP Registry version, no listing edits.
Verified live via `tools/list` on both endpoints after deploy
`dpl_5TG63ftgqMzKMyNTaNcNKCeZMHau`.

**Next.** Glama should pick the change up on its next re-read of
`/api/mcp` — re-check its page and disambiguation score with the pending
~2026-10-05 Glama check. Smithery keeps its stored copy until re-scanned
from the owner's Smithery account.

---

## PUBLIC TOOL WORDING — LEADS WITH WHEN TO USE IT — 2026-10-04

**Why.** A read-only audit of the tool-selection path found the public
`check_agent_trust` description led with how it works rather than when to
use it, lacked "unknown" and "pre-invocation", and — like every discovery
surface — never said "MCP server", although 150 of 152 covered agents are
MCP servers imported from the MCP Registry.

**What.** `eabe9d7`, on `/api/mcp/public` only (`src/lib/mcp/server.ts`):
- Tool description (542 → 490 chars) now opens: "Pre-invocation trust
  check for an unknown AI agent or MCP server endpoint. Pass the exact URL
  you are about to call as endpointUrl to get what AgentTrust has observed
  about it: …", keeping read-only, no API key, never contacts endpointUrl,
  and `{ matched: false }` for unknown URLs.
- Server instructions now open: "AgentTrust offers one read-only tool,
  check_agent_trust, for checking an unknown AI agent or MCP server before
  calling it."
- No directive wording (the existing test against "preferred" / "only
  proceed" / "before invoking" still passes); a new test pins the trigger
  phrasing.

**Unchanged.** Tool name, title, input/output schemas, annotations,
behavior, `/api/mcp` (its pinned snapshots match). Claude's directory reads
tools live — no resubmission, as the name is unchanged; no MCP Registry
version (it stores no tool descriptions). Verified live after deploy
`dpl_8BmB7713UE6D2L3aJF8PFjRJW7Nf`.

**Deferred.** Aligning `/api/mcp` (drop "The preferred…", add annotations,
point `list_agents` at `check_agent_trust`) would change its pinned output;
held until the public change has been observed. No usage effect is
measurable yet — Claude tool calls remain below the dashboard's threshold.

---

## CLAUDE DIRECTORY USAGE — FIRST DAY — 2026-10-03

**Dashboard (read 2026-10-03 13:56 UTC, ~22 h after publication).** Portal
`claude.ai/directory/manage/agenttrust`: Published; directory rank #2,158;
health "not enough data". Accounts, last 30 days: tried to reach the server
71 (overstates real use, per Anthropic), finished connecting 71, used a tool
1, disconnect rate 2.8%. Tool calls and error rate are below the reporting
threshold; the daily chart lags 2–3 days.

**Cross-checked against our own data (read-only, no hashes or IPs printed).**
- The one tool-using account is very likely the owner's 2026-10-02 12:47 UTC
  test (`client_family=claude-user`, before publication); no `claude-user`
  trust checks since publication.
- Connections are real: `/api/mcp/public` got 30 requests (27 POST 200) in
  the only log window available (13:36–13:56 UTC). Connecting and
  `tools/list` record no telemetry.
- `trust_check_events` since 2026-10-02 15:45 UTC: two new external MCP
  clients, `riaa-radariaagent` (3 checks, 10-02 19:37) and `objekts-agent`
  (1 check, 10-02 18:26), all `not_matched` — genuine third-party agent use;
  plus 11 web check-page events (`mozilla`) from ~8 callers (7 matched, 4 not),
  people or crawlers.

**Next.** No change needed. A large connect-to-use gap is expected early: Claude
calls the tool only when a conversation needs it. Re-check the dashboard once
calls pass its reporting thresholds.

---

## GLAMA — REGISTRY 1.0.4 NOT YET PICKED UP — 2026-10-03

**Checked (2026-10-03 13:50 UTC, ~22.5 h after registry 1.0.4, read-only).**
The registry still lists 1.0.4 with `/api/mcp/public` first and `/api/mcp`
second, but Glama's connector `io.github.agenttrust-ai/agenttrust` still
uses only `https://getagenttrust.com/api/mcp`:
- 5 tools, the old "The preferred pre-invocation trust check…" description,
  no MCP tool annotations shown.
- Healthy, last tested 2026-10-03 13:36 UTC, 100% uptime over 15 days;
  quality A 3.9/5 scored 2026-09-26 08:30; last tool change it detected was
  2026-09-26 (`reliabilityScoreStatus`).
- Its connector search for "agenttrust" has no second entry for
  `/api/mcp/public` (only ours and the unrelated `io.github.eamwhite1`).

Glama keeps monitoring its endpoint but has not switched endpoints; whether
it never follows registry remote changes or just syncs slowly is unknown.

**Next.** No product change — `/api/mcp` is healthy. Re-check around
2026-10-05 (~72 h after the update); if still only `/api/mcp`, use Glama's
owner controls (ownership is verified) or Glama support to switch it to the
public endpoint.

---

## CLAUDE DIRECTORY SEARCH — LISTING FINDABLE BY NAME — 2026-10-02

**Verified (16:51 UTC, signed in to the owner's account, read-only).** The
published listing `https://claude.ai/directory/agenttrust` loads with the
Community badge, the approved copy, `check_agent_trust`, sign-in not required
and connector URL `https://getagenttrust.com/api/mcp/public`.

Directory search (`claude.ai/directory?q=…`):
- `AgentTrust` → 1 result: the directory listing ("AgentTrust · Community ·
  by AgentTrust"). At 15:56 UTC the same search still returned only the
  owner's custom test connector, so the listing propagated within the
  "up to an hour" Anthropic states.
- `agent trust` (72 results) → AgentTrust first, but in the pinned "added to
  your account" section, so this says nothing about ranking for other users.
- `trust check` (63) and `agent endpoint` (61) → not among results shown.

**Limits.** Checked only from the owner's account, where it shows as
connected; a signed-out view is blocked by Cloudflare (HTTP 403 challenge),
so ranking for a new user is unverified.

**Next.** No change needed. Discovery by name works; generic-query ranking
depends on the directory's own signals (the portal's "directory rank" fills
from usage). Watch the portal dashboard, which reports about a day after the
first calls.

---

## CLAUDE CONNECTORS DIRECTORY — APPROVED AND PUBLISHED — 2026-10-02

**Published.** The AgentTrust connector submitted earlier on 2026-10-02 was
approved by Anthropic's directory review and published on 2026-10-02 at about
15:50 UTC. Portal status: **Published** (Submitted → Approved → Published).
Public listing: `https://claude.ai/directory/agenttrust`. Anthropic notes new
listings can take up to an hour to appear; the label is Community by default.
- Listed endpoint: `https://getagenttrust.com/api/mcp/public`, authentication
  none, one tool (`check_agent_trust`); available in Claude on web and mobile,
  Desktop, the Claude API and Claude Code.
- Published exactly as approved — no listing edits, which would have sent it
  back for review. The current site favicon/logo is the listing icon.
- The portal's dashboard (directory rank, health, accounts, tool calls, error
  rate) starts filling about a day after the first calls and updates daily.

**Next.** Watch the dashboard and `trust_check_events` for the first
directory-originated calls (`client_family` from Claude clients). Any listing
edit goes through review before replacing the live one; directory contact:
`mcp-review@anthropic.com`.

---

## MCP REGISTRY RELEASE 1.0.4 — PUBLIC CONNECTOR LISTED FIRST — 2026-10-02

**Released.** `io.github.agenttrust-ai/agenttrust` 1.0.4 is the latest
active version in the official MCP Registry (published 2026-10-02 15:21 UTC
by workflow run #2, GitHub Actions OIDC), replacing 1.0.3. Remotes, in order:
1. `streamable-http` `https://getagenttrust.com/api/mcp/public` — no headers:
   one read-only, annotated tool (`check_agent_trust`), no auth.
2. `streamable-http` `https://getagenttrust.com/api/mcp` — optional
   `Authorization` header for the four API-key tools.

The public endpoint is listed first because directories that ingest the
registry may use only the first remote; title and description are unchanged.

**Code.** `ad6efb9` changed only `server.json` and both endpoints' reported
`serverInfo` version (1.0.3 → 1.0.4), deployed before publishing so the
registry never listed a version production didn't report. Verified live:
both endpoints report `agenttrust` 1.0.4; `/api/mcp`'s `tools/list` matches
its pinned snapshot and `/api/mcp/public`'s matches its pre-change capture —
no tool, schema, auth or rate-limit change.

**Next.** Watch registry-fed directories (Glama; PulseMCP when it reopens)
pick up the public endpoint.

---

## CLAUDE CONNECTORS DIRECTORY — SUBMITTED, IN REVIEW — 2026-10-02

**Submitted.** AgentTrust was submitted as an MCP connector through Claude's
developer portal (`claude.ai/directory/manage`) on 2026-10-02. Portal
status: **In review** (검토 중). Anthropic contacts the account email; review
can take weeks and approval is not guaranteed.
- Endpoint: `https://getagenttrust.com/api/mcp/public` — one tool
  (`check_agent_trust`, read-only, idempotent), authentication: none.
- Listing: name `AgentTrust`, slug `agenttrust` (permanent), categories
  Development tools and Data & Analytics (no Security category exists).
  Docs `https://getagenttrust.com/docs`, privacy
  `https://getagenttrust.com/privacy`, support `dlrhkdaud5592@naver.com`.
- Icon: the current site favicon/logo was retained — no custom icon and no
  logo change (later logo explorations were not adopted).
- Use cases: read only, no prerequisites; reviewer test instructions need no
  account. Data handling: first-party API, no health data, no sponsored
  content. Self-tested with MCP Inspector CLI 2.9.0 and as a Claude custom
  connector. All 7 policy acknowledgements confirmed.

**Next.** Watch the portal for review feedback. No product change was made
for the submission itself (code at `e4fa0a8`).

---

## PUBLIC MCP CONNECTOR + RATE-LIMIT IP HASH CLEANUP (0010) — LIVE — 2026-10-02

**Public connector.** `/api/mcp/public` (`6c5937b`, input validation
`d7e37e7`) is a Streamable HTTP MCP endpoint with no authentication that
exposes only `check_agent_trust`, for directories that list servers without
auth (Claude's Connectors Directory). It shares the handler, output schema,
rate limit and telemetry with `/api/mcp`, and adds:
- annotations `title: "Check Agent Trust"`, `readOnlyHint: true`,
  `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`;
- neutral description and server instructions (no "preferred" / "only
  proceed after…" wording, which directory review treats as prompt
  injection);
- an `endpointUrl` check (absolute http(s) URL) that rejects malformed input
  with an actionable error before the tool runs — no rate-limit or telemetry
  cost. The advertised input schema is identical to `/api/mcp`'s.

The four API-key tools are not exposed there (`-32602 Tool … not found`).
`/api/mcp` is unchanged: its live `initialize` (agenttrust 1.0.3) and
`tools/list` matched the pre-change baseline, and both are now pinned by
snapshot tests (`src/app/api/mcp/__snapshots__/`).

**Site.** `/privacy` (footer, sitemap) describes current data handling:
telemetry, rate-limit hashing and retention, accounts, agents and monitoring,
Vercel/Supabase. `/docs` documents the public endpoint and adds a Support
section. Support/security contact: `src/lib/contact.ts`.

**Verified.** Production checks 2026-10-02 passed with an MCP Inspector CLI
2.9.0 run and a Claude custom-connector test: Claude matched `support-bot`
(recommended, low confidence) at 12:47:31 UTC, `client_family=claude-user`,
`caller_key` non-null — confirming telemetry's keyed hashes work in
production. Five synthetic verification events (05:55–06:47 UTC; client
families `agenttrust-*` and `node`) should be excluded from usage analysis.
Earlier external `/api/mcp` events from `toucan-datagen` (8 since 2026-10-01
18:18 UTC, all unmatched, mostly `example.com` hosts) look like an automated
synthetic-data client, not pre-invocation use.

**Rate-limit IP hashes.** `2586655` replaced the anonymous rate limiter's
unsalted SHA-256(IP) with HMAC-SHA256 under a daily-rotating HKDF subkey of
`API_KEY_HASH_PEPPER` (label `agenttrust/anonymous-rate-limit/ip/v1/day=…`;
UTC midnight is always a window boundary), plus bounded cleanup on ~1% of
checks: per-IP rows > 1 day, `GLOBAL` rows > 90 days. Data-only migration
`0010_purge_legacy_rate_limit_ip_hashes` (`e4842b2`) was applied to
production at 12:52 UTC: it deleted the 44 legacy per-IP rows, leaving 0 of
them; the 55 `GLOBAL` rows and 12 keyed rows remain; 11 migrations applied.

**Next.** Submit `/api/mcp/public` in Claude's developer portal (needs a
paid plan, icon, listing copy, example prompts and policy acknowledgments;
auth: none). Watch the shared per-IP limit: Claude's hosted surfaces call
from Anthropic's egress range, so many users may share 10 checks/min per IP.

---

## CHECK_AGENT_TRUST USAGE TELEMETRY (PHASE 1) — LIVE — 2026-10-01

**Why.** Before this, a `check_agent_trust` result was discarded once sent:
only per-minute anonymous rate-limit counters existed, so real external AI
usage could not be proven (94 anonymous checks from 23 hashed callers,
2026-09-19 → 30, none attributable, none repeated across days).

**What.** `2964442` records each completed check (MCP tool `surface=mcp`,
web check page `surface=web`) in `trust_check_events`, after the response
is sent via `after()` — best-effort, failures swallowed; the MCP response,
scoring and trustDecision are unchanged. Module:
`src/lib/telemetry/trust-check-events.ts`.
- Matched: `agent_id`, `recommended`, `confidence`. Unmatched: sanitized
  public `endpoint_host` (null for IP literals, localhost, single-label and
  internal/reserved names) + `endpoint_key`.
- Never stored: raw IP, full URL, path, query, fragment, request body,
  header values beyond the user-agent's product token (`client_family`), API
  keys or credentials. Rate-limited calls are not recorded.
- Keyed hashes from `TELEMETRY_HASH_KEY` via HKDF-SHA256 subkeys (the key
  itself never rotates): `caller_key` = HMAC of the IP under a subkey that
  changes every 30 days (unlinkable across periods); `endpoint_key` = HMAC of
  the normalized URL without query/fragment under a separate, time-independent
  subkey (stable while the key is unchanged — changing it resets continuity).
- Bounds: 5,000 events/UTC day, 50 per caller/day; rows older than 90 days
  swept on ~1% of inserts. RLS enabled with no policies.
- Unmatched demand is analysis input only — it never triggers crawling,
  registration, monitoring or endpoint contact.

**Rollout.** Migration `0009_add_trust_check_events` applied to production
first (10 migrations; table, 3 indexes, 6 constraints, RLS on, 0 policies),
then `2964442` deployed. `TELEMETRY_HASH_KEY` added in Vercel (Production,
encrypted) at ~12:55 UTC and picked up by redeploy
`dpl_mXFzoQFRJQeg6Sf7tEDP84QcG7HP` (12:58 UTC, Ready). No synthetic
telemetry was created; the table had 0 rows at verification (13:16 UTC).
Keyed hashes are confirmed once the first real event shows a non-null
`caller_key` (a key shorter than 32 characters is ignored, leaving them null).

**Next (separate).** The anonymous rate limiter stores unsalted SHA-256 IP
hashes with no retention (`anonymous_rate_limits`) — effectively reversible.
Salt/key them and prune old windows.

---

## MCP REGISTRY RELEASE 1.0.3 — PUBLISHED VIA GITHUB ACTIONS OIDC — 2026-09-29

**Released.** `io.github.agenttrust-ai/agenttrust` 1.0.3 is the latest
active version in the official MCP Registry (published 2026-09-29 13:47 UTC),
replacing 1.0.2's listing from 2026-09-20. The production MCP server reports
the same version in `initialize` (`5b40c86`).
- Title: "AgentTrust — Pre-Invocation AI Agent Trust & Reliability Checks".
- Description: "Check an AI agent endpoint before you call it: read-only, no
  API key, returns a trustDecision." The registry caps descriptions at 100
  characters; the previous local one (~280) is why the improved metadata had
  never been published.
- Remote unchanged: streamable-http `https://getagenttrust.com/api/mcp`. No
  tool, schema, or behavior change.

**How it was published.** `.github/workflows/publish-mcp-registry.yml`
(`9bc7ac0`): manual dispatch only, from `main`; `permissions: contents: read,
id-token: write`; `mcp-publisher` 1.8.1 pinned by SHA-256 and
`actions/checkout` pinned to a commit. The registry grants
`io.github.agenttrust-ai/*` from the OIDC token's `repository_owner` claim.

**Why not `mcp-publisher login github`.** Its device-flow login is a GitHub
App; the registry grants an org namespace only to org Owners it can see via
`GET /user/memberships/orgs`, which that App's token can't see unless the App
is installed on the org. Making org membership public or changing the org's
OAuth app policy doesn't help (see registry issues #1551, #1649). No GitHub,
org, or OAuth setting was changed; `agenttrust-ai` keeps "Access
restricted", and membership of `leegwangmyeong` is now public.

**Next release.** Bump `version` in `server.json` and the `serverInfo`
version in `src/app/api/mcp/route.ts`, deploy, then run the workflow from
the Actions tab. The registry rejects a version that already exists, and
published versions can only be deprecated, never deleted.

---

## P0 RELIABILITY-SCORE FRESHNESS BUG — VERIFIED FIXED — 2026-09-29

**Bug.** On 2026-09-27, 18 agents scored at ~00:44 UTC with exactly 5
checks in their 7-day window went `stale` 1–2 s later: freshness
re-counted a 7-day window ending at *read* time, so their oldest sample
aged out between daily runs with no new evidence either way.

**Fix.** `927e636` — freshness is anchored to observations: a score is
`fresh` when it exists, is at most 50 h old, and no health check ≥ 10 min
newer than its `window_end` failed to replace it. No schema, scoring,
monitoring, REST or MCP shape change.

**Verification (read-only, against the normal 2026-09-29 run):**
- 92/92 pre-existing active pull-mode agents checked; 52 new reliability
  scores.
- 52/52 remained `fresh`, 0 `stale`, at every 10-minute step from
  computation to verification time, and projected to the next run.
- 0 fresh → stale transitions from the 2026-09-28 11:06 UTC baseline.
- No `trustDecision` changed because of an unexpected freshness transition.
- Public (anon role) and owner (authenticated) read paths agreed on every
  agent.
- A regression test replaying the exact 2026-09-27 production timestamps
  fails on the old logic and passes on the fix.
- Production at verification: 102 active pull-mode agents — 52 `fresh`,
  50 `none`, 0 `stale`.

**Caveat.** The 2026-09-29 live population did not reproduce the historical
trigger by itself: every agent is now checked daily (the per-run cap was
raised from 20 to 500 on 2026-09-24), so check histories no longer have the
gaps the trigger needs. The regression replay is what proves the fix; the
live run shows no regression. The trigger can only recur after missed runs
or above 500 active agents.

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
