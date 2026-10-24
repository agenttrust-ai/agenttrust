# AgentTrust — Project Checkpoints

Durable, point-in-time records of major project-state milestones. Each
entry is a snapshot, not a living document — update by adding a new dated
entry above the previous one, not by editing history.

---

## DEPENDENCY SECURITY PATCHES (STAGES 1 AND 2) — LIVE — 2026-10-24

**Why.** `npm audit --omit=dev` reported 1 critical and 5 high advisories.
Checked against the code, the ones that reach this app were: Next.js Server
Actions DoS (the app uses server actions), Next.js Image Optimization SVG RCE
and SSRF (`/_next/image` is on by default), MCP SDK memory exhaustion from
one request (GHSA-46jr, reachable without a key on `/api/mcp/public`), zod
collection memory exhaustion, and undici crashes from untrusted HTTPS
servers (monitoring fetches untrusted endpoints). Not applicable: `next/og`
and `use cache` RCEs (unused), GHSA-jm63 (mcp-handler builds a new server per
request), the SDK bearer-auth issue (its verifier isn't used), and undici's
dropped-`Agent`-options issue (our DNS guard goes through `connect.lookup`).

**Stage 1 — Next.js.** Commit `5d57e13` ("fix(deps): upgrade Next.js to
16.4.3 for security advisories"). `next` and `eslint-config-next` 16.3.4 →
16.4.3, `sharp` 0.35.4 → 0.35.5, `source-map-js` 1.2.1 → 1.2.2; adds
`src/lib/security/dependency-floors.test.ts`, which fails if
`package-lock.json` falls below the patched versions. Deployment
`dpl_D4LbW3egdSiJdPMooC5bWXbV2FF3`, automatic on push, READY
2026-10-24 08:42:30 UTC.
- Before the commit: full suite 58 files, 1,305 tests passed, 0 failed;
  typecheck, ESLint and production build passed (same route table);
  production audit 0 critical, 3 high (the Stage 2 packages).
- Live: pages 200, security headers identical to before, `/dashboard`
  307 → `/login`; `/api/mcp` `initialize`/`tools/list` byte-identical to the
  committed snapshots, `/api/mcp/public` byte-identical to a local build of
  the same commit; one read-only `check_agent_trust` of the test agent
  (healthy, 100, verified, recommended); 0 × 5xx after the deploy.

**Stage 2 — MCP SDK, zod, undici and request limits.** Commit `4d59aa0`
("fix(deps): patch MCP SDK, zod and undici; bound MCP request size").
`@modelcontextprotocol/server` and `core` 2.0.0 → 2.3.1, `zod` 4.5.4 → 4.6.7,
`undici` 8.10.2 → 8.12.3; `mcp-handler` stays 2.1.1 (no advisory). The SDK
upgrade alone doesn't fix GHSA-46jr, so `src/lib/mcp/request-limits.ts` adds,
on both MCP routes:
- a 64 KiB POST body limit, answered with the SDK's own 413 JSON-RPC error.
  It lives in the route because mcp-handler parses the body itself, and the
  SDK skips its own limit when handed a parsed body;
- `maxToolInputElements: 100` for tool-call arguments (the largest tool
  input has 3 arguments). mcp-handler forwards it to `new McpServer(...)`
  although its options type doesn't list it; a test checks it's enforced.

Deployment `dpl_FUZECyPxT7pdFgVBp1Si6WdV1s5t`, automatic on push, READY
2026-10-24 09:21:38 UTC.
- Before the commit: full suite 59 files, 1,316 tests passed, 0 failed
  (new: 7 request-limit tests on both routes, 4 more dependency floors);
  each new test failed with its protection removed (body limit, tool-input
  limit, one server per request); typecheck, ESLint and production build
  passed; MCP snapshots unchanged.
- Production audit (`npm audit --omit=dev`): **0** vulnerabilities. Dev-only
  advisories remain and are pre-existing: `drizzle-kit`/`esbuild`,
  `vitest`/`vite`, `brace-expansion` (moderate 6, high 2).
- Live: pages and files 200, security headers identical to before,
  `/dashboard` 307, `/api/v1/agents` without a key 401, MCP GET 405 on both
  routes; `/api/mcp` `initialize`/`tools/list` byte-identical to the
  snapshots, `/api/mcp/public` byte-identical to a local build of the same
  commit (and, before the deploy, to the previous production); one read-only
  check with the published SDK 0.1.3 from a fresh install: `support-bot`
  healthy, reliability 100 (fresh), verified, `recommended: true`, high
  confidence; 0 × 5xx in the first minutes (48 calls), MCP max 647 ms.
- Not tested live: the 413 response (optional, not approved); covered by
  local and test checks.

**Result: PASS.** No database, auth, rate-limit or telemetry changes; MCP
Registry listing and the SDK package unchanged. Rollback target for Stage 2:
`dpl_D4LbW3egdSiJdPMooC5bWXbV2FF3` (Stage 1); for both: `dpl_2PY8d4QyDBw5uhZzEreWqKDgBnoQ`.

**Pending:** the first scheduled cron runs on the Stage 2 deployment —
health checks 2026-10-25 00:00 UTC, discovery 03:30 UTC — and the cumulative
5xx rate since the deploy. Monitoring now uses undici 8.12.3, so a successful
health-check run is the remaining verification.

---

## TRUST REPORT TRACE ROW — 280 px OVERFLOW FIXED — LIVE — 2026-10-24

Fixes the 280 px limitation recorded in the Issue 2 entry below.

**Change.** Commit `890013e` ("fix(ui): prevent trust report overflow on
narrow screens"); only `src/components/check/resolution-trace.tsx` and
`src/components/network/network.test.ts`. The decorative trace row above a
result ("Endpoint — observations — Trust report / No match") gains
`flex-wrap`. Where the row doesn't fit (below about 301 px, or with larger
browser text), the last label moves to a second line instead of overflowing.
The screen-reader text is unchanged.

**Deployment.** Automatic on push (`source: git`, nothing triggered by
hand): `dpl_5NasgyfhYXseHRDHjQbjYavCmJ9M`, production, created 07:48:41 and
READY 2026-10-24 07:48:59 UTC, aliased to `getagenttrust.com`.

**Evidence.**
- Before the commit: full suite 57 files, 1,301 tests passed, 0 failed
  (one new test pins the row's classes for both result types and fails
  without `flex-wrap`); typecheck, ESLint and production build passed.
- Live, one read-only check of
  `https://agenttrust-umber.vercel.app/api/test-agent`: Recommended,
  healthy, reliability 100/100. Measured on that one page load:
  - 280 px: page overflow 5 px → 0 px; the row fits (248 px) and
    "Trust report" wraps to a second line.
  - 320, 375 and 1024 px: one line, with "Trust report" at the same
    position as before the change; no page overflow.
- "No match" result: not checked live (checking an unknown URL can queue a
  lookup). Before deploy, its rendered markup was measured in the browser:
  it wraps at 280 px and is identical to before at 320, 375 and 1024 px.

**Result: PASS.**

---

## /check-agent-trust DEVELOPER NEXT STEPS (ISSUE 2) — LIVE — 2026-10-24

**Change.** Commit `fb07b8e` ("feat(check): point /check-agent-trust
developers to the public connector, Claude Code and the SDK"); only
`src/app/check-agent-trust/page.tsx` and its new `page.test.ts`. The
developer section names the public no-key connector `/api/mcp/public`
instead of the keyed server, adds the Claude Code command, MCP client and
SDK links and `npm install @getagenttrust/sdk`, and a matched or unmatched
result links to that section. The trust-check logic, auth, rate limits,
telemetry, APIs and database are unchanged.

**Deployment.** Automatic on push: `dpl_A8A3tDaRhtFwaEDFTX6ph6pbZFhx`,
production, READY 2026-10-24 06:50:57 UTC, aliased to `getagenttrust.com`.

**Evidence.**
- Full suite before the commit: 57 files, 1,300 tests passed, 0 failed;
  typecheck, ESLint and production build passed.
- Live page: the public connector URL, the exact Claude Code command and the
  SDK install line are present, the keyed URL is gone from the section, and
  `/docs#mcp-clients`, `#sdk` and `#mcp` resolve. The connector's
  `initialize` and `tools/list` return only `check_agent_trust`
  (read-only).
- Layout matches the local build: 1024 px and 375 px, h1 and form
  unchanged, no horizontal page overflow; the Claude Code command scrolls
  inside its code block (by 20 px at 1024 px).
- One read-only live check of `https://agenttrust-umber.vercel.app/api/test-agent`
  through the page: recommended, confidence high, healthy, reliability 100,
  ownership verified; the new result link is shown. No page overflow with a
  result at 1024, 375 or 320 px.

**Result: PASS.**

**Known limitation (pre-existing, not from this change):** at a 280 px
viewport the result card's "Trust report" breadcrumb
(`src/components/check/resolution-trace.tsx`) overflows by 5 px. 320 px
and wider are unaffected.

---

## FOOTER llms.txt LINK — NO MORE 404 PREFETCH (ISSUE 3) — LIVE — 2026-10-24

_Recorded retroactively on 2026-10-24 from Vercel records and the session log._

**Change.** Commit `966b0de` ("fix(footer): render the llms.txt link as a
plain anchor to avoid a 404 prefetch"); only
`src/components/shell/site-footer.tsx` and `src/app/page.test.ts`. A
footer link can be marked `staticFile`, which renders a plain `<a>` instead
of `next/link`; only `/llms.txt` uses it. `next/link` had been prefetching
the static file as a page (`/llms.txt?_rsc=…`), which returned 404 and
logged a console error.

**Deployment.** Automatic on push: `dpl_7uZJgvMEjouNkxBeWzXwV5pAiULk`,
production, created 06:00:39 and READY 2026-10-24 06:00:58 UTC.

**Evidence.**
- Before the commit: 3 new footer tests, 141/141 focused tests (home,
  privacy, docs, discovery), typecheck, ESLint and production build passed.
  The full suite wasn't run for this commit alone; the Issue 2 full run
  (1,300 passed) includes these tests.
- Live, in a fresh browser tab: no `/llms.txt?_rsc` request and an empty
  console. The other page links were still prefetched as before.
  `/llms.txt` returns 200 `text/plain`. The Developers footer order is
  unchanged, and clicking `llms.txt` opens the file.
- No 5xx after the deploy.

**Result: PASS.**

---

## llms.txt AND AGENT CARD → PUBLIC MCP CONNECTOR (ISSUE 1) — LIVE — 2026-10-24

_Recorded retroactively on 2026-10-24 from Vercel records and the session log._

**Change.** Commit `0583104` ("docs(discovery): direct agents to public MCP
connector"); only `public/llms.txt`, `public/.well-known/agent-card.json`
and their two tests (`src/lib/discovery/llms-txt.test.ts`,
`agent-card.test.ts`). The `llms.txt` workflow steps 2 and 3, and the agent
card's `check-agent-trust` skill description, now send no-key users to
`https://getagenttrust.com/api/mcp/public` instead of `/api/mcp`.

**Deployment.** Pushed 05:03 UTC. Vercel received the push about 48 minutes
late, with no incident on either status page. It then deployed automatically
(`source: git`, nothing triggered by hand): `dpl_AATcNGeVigUWgECoSzYoTSESLRny`,
created 05:51:03 and READY 2026-10-24 05:51:22 UTC.

**Evidence.**
- Before the commit: full suite 56 files, 1,290 tests passed, 0 failed;
  typecheck, ESLint and production build passed. Mutation checks: putting
  the keyed URL back in the agent card, or removing the public connector
  from step 3, each failed a test.
- Live: `/llms.txt` (200 `text/plain`) and
  `/.well-known/agent-card.json` (200 `application/json`) are
  byte-identical to the committed files. Compared with the previous card
  (`988324e`), only `skills[0].description` changed; `url`, `security`,
  `securitySchemes`, `protocolVersion` and the other fields are identical.
  The authentication wording in `llms.txt` is unchanged.
- No 5xx after the deploy.

**Result: PASS.**

---

## SDK @getagenttrust/sdk 0.1.3 — PUBLISHED AND VERIFIED — 2026-10-20

**Release.** `@getagenttrust/sdk@0.1.3` published to npm 2026-10-20
11:04:38 UTC (`latest`) by the "Publish SDK to npm" workflow
(`.github/workflows/publish-sdk.yml`, run 39412143701) through npm Trusted
Publishing — no stored npm token. GitHub source commit `e4b668a`
(`e4b668a7d028155f6a2f960a5e8afff600562f64`, "chore(sdk): prepare v0.1.3
documentation release"). Documentation-only: versus 0.1.2, only the
version, `SDK_VERSION` (User-Agent `agenttrust-sdk/0.1.3`), README and
CHANGELOG differ.

**Verified (read-only, as an external developer, fresh install outside the
repository, Node.js 24):**
- Trusted Publisher and npm provenance: the SLSA v1 attestation names
  `agenttrust-ai/agenttrust` at `refs/heads/main`, commit `e4b668a`, workflow
  `publish-sdk.yml`, GitHub-hosted runner; its SHA-512 matches the registry
  tarball and the registry `gitHead` matches. `npm audit signatures` verifies
  the signature and attestation. The installed files are byte-identical to
  the tarball packed locally from the reviewed commit.
- Fresh `npm install @getagenttrust/sdk@0.1.3`: passed (no dependencies).
- ESM `import`, CommonJS `require()` and TypeScript (strict; NodeNext,
  `.cts`, Bundler, CommonJS/node10) checks: passed.
- All 5 TypeScript examples in the published README compiled as written.
- Live anonymous read-only `checkAgentTrust` on
  `https://agenttrust-umber.vercel.app/api/test-agent`: passed —
  `support-bot` healthy, verified, reliability 100 (fresh), confidence high,
  `recommended: true`.
- Error-handling tests: 9/9 passed (local test servers, no production
  traffic).
- No production writes and no `send_heartbeat` calls; the only production
  request was that one anonymous check.

**Result: PASS.**

**Remaining limitation:** Node.js 18, 20 and 22 were not individually
tested (only Node.js 24).

---

## API TIMEOUTS P2 — PROJECT DEFAULT MAX DURATION 300 s → 60 s — 2026-10-19

_Recorded retroactively on 2026-10-20 from Vercel records and the session log._

**Change (no code commit).** The Vercel project default function timeout
(`resourceConfig.functionDefaultTimeout`) was set from Vercel's 300 s default
to 60 s through the project API; a before/after comparison of every project
setting showed this as the only change [session]. Explicit route values from
P1 keep precedence: crons 300 s, MCP 30 s, other API routes 10–15 s. The
setting applies per deployment, so commit `6aa6b39` was redeployed:
`dpl_9sniHAMj16pfBSs9AHdV9WDg4oMd`, READY 2026-10-19 08:08:36 UTC,
`config.functionTimeout: 60` (the P1 deployment showed 300) [Vercel].

**Evidence.**
- 11/11 read-only post-deploy smoke tests passed (pages, MCP `initialize` and
  `tools/list` on both routes matched the pinned snapshots, `check_agent_trust`
  on `support-bot`, `test-agent`, `auth/callback`, 401 checks); no 5xx after
  the deploy [session].
- In the 14 days before, the functions now inheriting the default (pages,
  server actions, 404, proxy) never ran longer than 1.78 s [Vercel metrics,
  session].
- First cron runs under a 60 s-default deployment, on 2026-10-20 (on
  `dpl_GRhW3hFByvpXhX1a1JERmxGn7n5c`, `config.functionTimeout: 60`): health
  checks HTTP 200, 40.1 s, 298 MB; discovery HTTP 200, 4.2 s, 249 MB
  [Vercel metrics]. Both stayed under 60 s, so these runs don't by themselves
  prove the crons' explicit 300 s; that's shown by the P1 build manifest.

**Result: PASS.** Rollback: promote `dpl_HksLf7NvMUag2UGx1zHkrHvM251H`
(300 s default) or set the project default back to 300 and redeploy.

---

## API TIMEOUTS P1 — EXPLICIT maxDuration ON EVERY API ROUTE — 2026-10-18

_Recorded retroactively on 2026-10-20 from git, Vercel records and the session log._

**Change.** Commit `6aa6b39` (`6aa6b392e933a3f840dd6a913fa9701b691c0b40`,
2026-10-18 11:47:09 UTC, "fix(api): set explicit maxDuration on every API
route", 8 files) [git]: the discovery cron 300 s (made explicit); v1 agent
routes and heartbeat 15 s; `/api/test-agent` 10 s; `/auth/callback` 15 s. The
health-check cron (300 s) and both MCP routes (30 s) were unchanged. New
`src/app/route-max-duration.test.ts` requires every route to declare one and
pins all 10 values.

**Evidence.**
- Regression test 31/31; it failed 4 tests when a timeout was removed or
  lowered (mutation check). Full suite 52 files / 1,226 tests passed;
  typecheck and lint passed [session].
- Production build `functions-config-manifest.json` listed all 10 values
  [session]. Vercel's API doesn't expose per-route `maxDuration` for Git
  deployments, so the deployed values are confirmed from the deployed commit
  and that build.
- Deploy `dpl_HksLf7NvMUag2UGx1zHkrHvM251H`, READY 2026-10-18 11:47:35 UTC
  [Vercel]; 11/11 read-only smoke tests passed; no 5xx after the deploy
  [session].
- First cron runs under it, 2026-10-19: health checks HTTP 200, 39.3 s,
  295 MB; discovery HTTP 200, 2.0 s, 249 MB — within the previous three
  days' ranges (38.6–39.2 s, 1.9–3.0 s) [Vercel metrics].

**Result: PASS.**

---

## SDK @getagenttrust/sdk 0.1.2 — SECURITY AND COMPATIBILITY FIXES — 2026-10-15

_Recorded retroactively on 2026-10-20 from git, the npm registry and the session log._

**Release.** Commit `563280f` (`563280fb9f496b90a34f7ffefaefd4a18fb5b427`,
2026-10-15 14:09:54 UTC, "fix(sdk): v0.1.2 security and compatibility
fixes") [git]; published 2026-10-15 14:17:36 UTC by `publish-sdk.yml` (run
38749851052) with SLSA provenance naming this commit; registry `gitHead`
matches [npm]. Fixes found by the 0.1.1 external test:
- **Security:** the boolean policy options (`allowUnknown`,
  `requireRecommended`, `requireVerified`) were read by truthiness, so e.g.
  `allowUnknown: "false"` accepted unknown endpoints (fail-open). They now
  throw `TypeError`. URLs with embedded credentials are rejected
  (`INVALID_URL`) instead of being sent to AgentTrust.
- HTTP 429 → `RATE_LIMITED` with `retryAfterSeconds` (seconds or HTTP date);
  CommonJS `require()` works (`"default"` export condition); invalid client
  and per-call options throw `TypeError`.

**Evidence.** Before publishing: SDK tests 161/161 (79 failed with the old
policy logic restored), SDK contract tests 5/5, package compatibility 16/16,
offline end-to-end 102/102 [session]. After publishing: external smoke test
19/21; the 2 failures were documentation gaps, later fixed in 0.1.3 [session].
0.1.0 and 0.1.1 were then deprecated on npm with range `>=0.1.0 <0.1.2`;
verified 2026-10-19: both carry the security message, 0.1.2 and
`0.0.0-stage` don't [npm, session].

**Result: PASS.**

---

## SDK @getagenttrust/sdk 0.1.1 — FIRST TRUSTED-PUBLISHING RELEASE — 2026-10-15

_Recorded retroactively on 2026-10-20 from git, the npm registry and the session log._

**Release.** Workflow `.github/workflows/publish-sdk.yml` added in `3b6d525`
(2026-10-15 12:26:27 UTC; manual dispatch on `main` only, OIDC, provenance,
duplicate-version guard); version prepared in `0827a49`
(`0827a498bb5a5b521ca2265c6bc02fc892614731`, 12:44:25 UTC) [git]. Published
2026-10-15 12:56:31 UTC by that workflow (run 38738209327) with SLSA
provenance naming `0827a49`; registry `gitHead` matches [npm]. No functional
change from 0.1.0; the User-Agent reported 0.1.1.

**Evidence.** Before publishing: SDK typecheck, root typecheck and lint
passed; SDK tests 36/36; contract tests 5/5; `npm pack` 12 files [session].
After publishing, an external end-to-end test passed 103/110; its findings
(fail-open policy values, 429 mapping, `require()`) became 0.1.2 [session].
Deprecated on npm (see 0.1.2) [npm].

**Result: PUBLISHED; superseded by 0.1.2.**

---

## SDK @getagenttrust/sdk 0.1.0 — FIRST RELEASE — 2026-10-14

_Recorded retroactively on 2026-10-20 from git and the npm registry._

**Release.** Commit `ec48215` (`ec4821537e370f6275520130534211e85a9d78e6`,
2026-10-13 13:24:38 UTC, "feat(sdk): @getagenttrust/sdk 0.1.0 — TypeScript
SDK for pre-connection trust checks", 13 files) [git]. Published manually
(no provenance attestation) on 2026-10-14 at 10:21:31 UTC; registry
`gitHead` `ec48215` [npm]. `checkAgentTrust`, `assertTrusted`,
`evaluatePolicy`, `createAgentTrustClient`, typed errors; anonymous, no
dependencies, ESM. The npm org `getagenttrust` enforces 2FA. The placeholder
`0.0.0-stage` (10:18:53 UTC) is npm's staged-publishing holder: README and
`package.json` only, no code [npm].

**Evidence.** Deployment of the commit `dpl_HSD14xDqCv6qHog4u1DoHR9Zbjs6`
READY [Vercel]. Pre-publish test counts for this exact commit aren't
recorded in a form I can verify, so none are claimed. Deprecated on npm
(see 0.1.2) [npm].

**Result: PUBLISHED; superseded and deprecated.**

---

## MCP COST FIX — +60-MINUTE VERIFICATION PASS — 2026-10-11

**Checked (read-only Vercel metrics, `POST /api/mcp/public`,
12:17:30–13:18:00 UTC, ~1 h after the `dffeae3` deploy), split by
deployment.** The docs-only push `0b1c33a` created
`dpl_HtWy3QCWhBxP2Zq77H1KHHPYCLRM` at 13:05 UTC with identical code, so two
deployments carry the fix:
- Fixed deployments (`dpl_Fuzr6upt…` 118 + `dpl_HtWy3QCW…` 31): **149
  requests**, average 23–44 ms, p95 65–338 ms, **longest 647 ms**, **0.0023
  GB-hours** (≈0.055/day vs 58.49/day on 2026-10-08: **≈99.9% lower**).
- Old pre-fix deployment `dpl_b8Eczns8…`: 2 requests, 300 s each, 0.3394
  GB-hours — subscription streams opened before the switch, ended ~12:20.
- **5xx 0.0%**; 4xx 4.7% (5 × 406, 2 × 400, probers; 4.0% before).
- `Claude-User` 115 requests in ~1 h (≈114/h vs 94.8/h average, hourly
  range 90–296, before): **no retry loop**; no client near 1,000/h.
- `/api/mcp`: 68 requests, 0.0% 5xx, longest 893 ms, 0.0013 GB-hours (its
  4xx are 406s from probers, as before).

**Result: PASS — rollback not required.** None of the rollback triggers
(connector failures, >1,000 requests/h sustained, >5% errors) occurred.

**Savings remain a projection** (≈$25/month, from ~1 h of metrics) until
verified against 24 hours of Vercel billing for 2026-10-12. Still open: a
real `check_agent_trust` call from inside Claude, and the scheduled
health-check run ~00:44 UTC 2026-10-12.

---

## MCP COST FIX — LISTEN STREAMS REFUSED, 30 s CAP — 2026-10-11

**Finding (read-only audit).** The 2026-10-09 suspension was an unpaid
invoice (`UNPAID_INVOICE`), not overuse — total usage 2026-10-08…11 was
$4.51, $0.00 billed. But ~99.7% of function GB-hours came from one
pattern: `POST /api/mcp/public` from Claude's connector (`Claude-User`),
where ~5% of requests stayed open 470–600 s. `mcp-handler` 2.1.1 accepts up
to 1,024 `subscriptions/listen` streams by default, and the SDK holds each
open (SSE keep-alive) until the client disconnects or the function times
out; the routes set no `maxDuration`. AgentTrust's tool list never changes
at runtime, so those streams never carried a notification. Likely also why
the Hobby plan's memory allowance ran out before the move to Pro
(hypothesis; not verified).

**Fix (`dffeae3864f2909e8d7ef433ca4c81f557e670ea`, deploy
`dpl_Fuzr6uptxGYYELdsrndisg5aFoVn`, READY 2026-10-11 ~12:18 UTC).** On
`/api/mcp` and `/api/mcp/public`:
- `maxSubscriptions: 0` — `subscriptions/listen` is refused at once with
  JSON-RPC `-32603 "Subscription limit reached"` (HTTP 200,
  `application/json`), no stream.
- `export const maxDuration = 30` — backstop for any request that would
  hold a function open.
- Tools, schemas, instructions, auth and the MCP contract unchanged (pinned
  `initialize`/`tools-list` snapshots identical). 8 new tests
  (`src/app/api/mcp/subscriptions.test.ts`; 6 fail without the fix). MCP
  route and affected files 292/292, typecheck, lint, build passed; the full
  suite was not re-run after the fix (local machine out of memory).
- Smoke test after deploy: `initialize`/`tools/list` 200 and identical to
  the snapshots; `subscriptions/listen` refused in ~170 ms on both routes.

**Observed after deploy** (`POST /api/mcp/public`, new deployment only,
12:17:30–12:53:45 UTC, vs all of 2026-10-08):
- Average duration 38,582 ms → 25 ms; p95 469,324 ms → 65 ms; longest
  600,264 ms → 638 ms. No long-running streams on the new deployment (the
  only 300 s requests after the switch were old-deployment streams ending
  ~12:20).
- GB-hours 58.49/day → 0.0014 in 0.6 h (≈0.057/day): **≈99.9% lower**.
- No retry loop: `Claude-User` 129/h vs 94.8/h average (hourly range
  90–296) before.
- 5xx 0.0%; 4xx 4.9% (406s from probers with a wrong `Accept`, same pattern
  as before, 4.0%).

**Savings — projection only.** From a 36-minute window, at the effective
rate billed on 2026-10-08 (≈$0.0143 per GB-hour): usage-based cost ≈$0.90/day
(≈$27/month) → ≈$0.05/day (≈$1.5/month), **≈$25/month saved (projected)**.
The $20/month Pro base is unaffected. Confirm against 24 h of billing.

**Remaining checks.**
- A real `check_agent_trust` call through the Claude connector (traffic
  and a direct MCP call look healthy; not yet tested from inside Claude).
- Monitoring recovery at the next scheduled health-check run, ~00:44 UTC
  2026-10-12 (all 152 scored agents still stale until then).
- 24-hour Vercel usage/billing for 2026-10-12, to confirm the projection.
- The server still advertises `tools.listChanged: true`, so clients keep
  trying to subscribe and are refused cheaply (~25 ms); left unchanged to
  keep the published contract.

---

## HEARTBEAT FIX LIVE; VERCEL OUTAGE 2026-10-09–11 LEFT ALL SCORES STALE — 2026-10-11

**Heartbeat fix (`ddb3b22`, "fix: prevent pull-mode heartbeat score
manipulation").** A heartbeat to a pull-mode agent wrote a push health
check and recomputed its score, so an owner could interleave successes
between failing probes — breaking the 4-failure streak that marks an agent
`down` and lifting uptime/score (`/docs` even advised heartbeats for "a
faster first score"). Now `handleHeartbeat` records a check and rescores
only for push-mode agents; a pull-mode heartbeat is still accepted (same
`{slug, status, lastHeartbeatAt}` response) and only updates
`lastHeartbeatAt`. REST and MCP share the handler. `/docs` and `llms.txt`
corrected. 4 new tests (the abuse test fails without the fix); one test
that asserted the vulnerable behavior now uses a push-mode agent. Full
suite 969/969, typecheck, lint, build passed. No migration. Owners can't
select push mode, so heartbeats now affect status/score for no
owner-registered agent; 0 push checks were seen in production [since
2026-10-02].

**Vercel outage.** The Vercel team was blocked on 2026-10-09 13:59 UTC
(`softBlock.reason = UNPAID_INVOICE`, Pro subscription showing `canceled`).
The push of `ddb3b22` on 2026-10-10 got GitHub status "Vercel: failure —
Account is blocked." and no deployment; `getagenttrust.com`, `/api/mcp`
and `agenttrust-umber.vercel.app` all returned HTTP 402 "Payment
required". After the owner restored billing (block cleared, Pro `active`),
`ddb3b22` was deployed to production from the GitHub commit (`gitSource`,
no local upload): `dpl_6QsWT8oUBvqJ7yD3hYFQ7ik4nRzi`, READY, aliased to
`getagenttrust.com` and `agenttrust-umber.vercel.app`.

**Post-deploy verification (2026-10-11, read-only).**
- `/`, `/docs`, `/llms.txt`, `agenttrust-umber.vercel.app` all 200;
  `llms.txt` has the new heartbeat wording, `/docs` no longer has "faster
  first score".
- MCP `/api/mcp`: `initialize` 200 (protocol `2025-06-18`, `agenttrust`
  1.0.4, `{tools:{listChanged:true}}`), `notifications/initialized` 202,
  `tools/list` 200 with the same 5 tools; `tools/list` and `initialize`
  identical to the committed snapshots. `/api/mcp/public` lists only
  `check_agent_trust`.
- Vercel crons registered and enabled on the new deployment
  (`run-health-checks` `0 0 * * *`, `discover-mcp-agents` `30 3 * * *`).

**Monitoring gap.** Scheduled runs simply didn't happen while blocked — no
health checks, scores or discovery on 2026-10-10 and 2026-10-11 (daily runs
2026-10-06…09: 162/172/182/192 checks, 0 HTTP 402). So no false failures
were recorded, but every score aged past the 50-hour limit at 2026-10-11
02:44 UTC: all **152 scored agents (of 202) are `stale`**, 50 have none, so
no agent can be `recommended` — every matched `check_agent_trust` returns
`insufficient_data`. Statuses are frozen at the 2026-10-09 run (173
healthy, 18 down, 1 degraded, 10 unknown). `support-bot` (verified
2026-10-07, last check 2026-10-09 HTTP 200, score 100) shows `recommended:
false, insufficient_data` until rescored.

**Next.** The next scheduled health-check run, ~00:44 UTC 2026-10-12, should
make every scored agent fresh again (`support-bot` back to recommended,
high confidence) — verify read-only then. Not triggered manually (standing
no-manual-cron rule).

**Remaining risks and follow-ups.**
- Billing is a single point of failure for the site, MCP and monitoring;
  add a billing alert or a backup payment method.
- 2026-10-10/11 monitoring and discovery are lost, not backfilled.
- Possible pre-2026-10-02 push rows on pull agents still count until they
  age out of the 7-day/last-10 windows — a read-only count would confirm.
- `send_heartbeat`'s MCP description ("marking it alive right now") is
  imprecise for pull agents; left unchanged to keep the published contract.
- `support-bot` heartbeat E2E still pending (would now only update
  `last_heartbeat_at`).

---

## SECURITY — AGENT TRUST FIELDS SERVER-ONLY, MIGRATION 0011 — 2026-10-07

**Finding (read-only audit).** A signed-in owner could write every column
of their own agent through the Supabase Data API: migration 0001 granted
`authenticated` table-wide INSERT/UPDATE, the "agents: owners manage" RLS
policy restricts rows, not columns, and `agents` had no triggers. So
`ownership_verified_at` (a "verified" badge with no proof),
`current_status` and `last_heartbeat_at` (forged health), and
`endpoint_url` (moving a verified agent to another origin while keeping
"verified") could all be set without the proof-check or monitoring flows.
The app's own owner writes ran as the same `authenticated` role, so the
database couldn't tell them apart. API-key revocation could also be undone
(`revoked_at` set back to null). Scores and health checks were never
forgeable: those tables have SELECT-only policies. The Data API (PostgREST
14.5) is enabled and connected, but returned 503 `PGRST002` (schema cache)
on every request during the audit, so it wasn't exploitable at that
moment. No agent was verified in production (0 of 172).

**Fix — code (`fc99274`, deploy `dpl_9szCHVLZBwLqvp8MuSaheTXtn6UM`).**
- New `withServerContext` (`src/lib/db/rls.ts`): a transaction on the
  server's own connection role, the same path monitoring already used.
- Owner writes to protected columns moved onto it, each keeping its
  explicit `owner_id` filter: `createAgent`, `updateOwnedAgent`,
  `activateOwnedAgent`, `startOwnershipVerification`,
  `checkOwnershipVerification` (claim and success write),
  `recordAgentHeartbeatBySlug`. Reads and deletes stay RLS-scoped.
- Test harness applies migrations from 0011 on after the RLS bootstrap,
  matching production order (otherwise 0001's blanket GRANT would undo
  0011 in tests).
- 42 security tests (`src/lib/db/trust-column-privileges.test.ts`); 29
  fail with 0011 removed. Full suite 965/965, typecheck, lint, build passed.
- Deployed before the migration: the previous code wrote these columns as
  `authenticated`, the new code works under both privilege sets.

**Fix — migration 0011 (`0011_protect_agent_trust_columns`), applied
2026-10-07 with `npm run db:migrate`.** Pre-flight: the 11 applied
migrations matched the repo (hash and timestamp); 0011 was the only one
pending. Verified read-only afterwards:
- 12 migrations applied; 0011's hash matches the committed file.
- `agents`: `authenticated` may UPDATE only `agent_card`,
  `capability_tags`, `description`, `name`, `updated_at`, `version`; no
  INSERT; no TRUNCATE (also revoked from `anon`). None of the 18 protected
  columns is updatable by it: `ownership_verified_at`,
  `ownership_verification_token`, `ownership_last_checked_at`,
  `current_status`, `last_heartbeat_at`, `next_check_at`,
  `last_verified_at`, `monitoring_mode`, `source`, `external_registry_id`,
  `discovered_at`, `owner_id`, `id`, `created_at`, `slug`,
  `endpoint_url_normalized`, `lifecycle_status`, `endpoint_url`.
- Trigger `agents_reset_ownership_on_endpoint_change` clears
  `ownership_verified_at` and `ownership_verification_token` whenever
  `endpoint_url` changes, by any path.
- `api_keys`: `authenticated` may UPDATE only `revoked_at`; trigger
  `api_keys_revocation_is_final` rejects changing it once set, for every
  role.
- Trigger functions: EXECUTE revoked from PUBLIC/`anon`/`authenticated`,
  `search_path` pinned. RLS policies unchanged. No rows modified.
- App after the migration: `/`, `/docs`, `/a/support-bot`,
  `/a/anthropic-status`, `/llms.txt`, agent card all 200; MCP `agenttrust`
  1.0.4, `tools/list` identical to the snapshot.

**Not exercised in production yet.** The newly guarded write paths
(create, update, activate, ownership start/check, heartbeat) are covered by
tests against the same migration; their first production use will be the
ownership-verification E2E on `support-bot`.

**Remaining.** Re-running 0001's blanket GRANT would undo 0011 (noted in the
migration). Owners can still insert `api_keys` rows (unusable without the
server-side pepper) and hard-delete their own keys. Disabling or narrowing
the Data API remains a useful extra layer — the app doesn't use it.

---

## CHANGE 1 — FIRST NATURAL MONITORING RUN VERIFIED — 2026-10-05

**Checked (2026-10-05 ~12:50 UTC, read-only).** Production queries ran only
in read-only transactions; nothing was triggered or written. Change 1
(`b7a7ca6`: 401/403/405/406 count as reachable) was deployed 2026-10-04;
this was its first scheduled run.

**The run occurred.** One run on 2026-10-05: 152 pull checks on 152
agents at 00:44:09–00:44:13 UTC, 112 scores written 00:44:10–00:44:44
(previous runs: 122/82, 132/92, 142/102). Every agent that existed at run
time was checked; the 10 active agents without checks were all created
at 04:25:26 UTC, after the run, as one batch of 10 (the daily discovery
cap).

**Change 1 worked.**
- All 110 checks returning 401/403/405/406 counted as reachable
  (405: 76, 401: 26, 406: 6, 403: 2); in the 10-04 run, 0 of 102 did.
- 400/404/5xx, timeouts and unknown errors all still failed (404: 8,
  503: 3, 400: 2, 502: 1, timeout: 2, unknown: 2).
- Reachable checks: 134/152, up from 23/142.
- `down` is still 93, by design: an agent that was `down` needs 2
  consecutive successes (`RECOVERY_THRESHOLD`) to turn `healthy`. Of the
  102 previously monitored agents now reachable, 80 remain `down` and 22
  `degraded`. The only status changes were 10 first-time agents,
  `unknown` → `healthy`. Replaying `deriveAgentStatus` over stored checks
  reproduces `current_status` for 162/162 agents.

**Freshness (current `classifyReliabilityScore`, replayed on stored
timestamps).**
- fresh/stale/none: just before the run 102/0/60; just after 112/0/50;
  after the 10-min settle window 112/0/50; at 12:51 UTC 112/0/50 (the
  "none" counts include the 10 agents created later that morning).
- The fresh → stale flicker is gone: 48 evaluations every 15 minutes from
  the end of the settle window to 12:51 UTC, 0 status changes across all
  162 agents. All 112 new scores have `windowEnd` equal to their
  triggering check from this run; none went stale after scoring.
- Transitions: fresh → fresh 102, none → fresh 10, none → none 50,
  fresh → stale 0.
- 40 agents were checked but got no new score: all have fewer than 5
  checks in 7 days and no earlier score, so all correctly show `none`.

**trustDecision.** 10 changed, 0 because of freshness. All 10 were first
scores: 3 healthy agents became recommended (low confidence; scores
98.48, 100, 80) and 7 `down` agents moved from insufficient_data to
not recommended (low; scores ~21–23). 86 existing scores changed with the
rolling 7-day window (84 up, by up to +19.35, mostly from reachable
checks now counting; 2 down), none changing a decision. The two drops:
`flux-apex-on-x1-arc` 99.56 → 74.76 from a real timeout in this run (still
healthy and recommended, low confidence), and
`skyros-economic-agent-platform` 94.68 → 94.23 with all checks successful
(older samples aged out of the window).

**Original production agents intact.** `anthropic-status` and
`support-bot`: active, public, pull, healthy, last check 00:44 UTC HTTP
200, score 100 fresh, recommended (low confidence, unverified); records
unmodified since 2026-09-11.

**Anomalies.** None.

**Next.** Change 1's reduction of `down` can only appear after the
second reachable check, at the next scheduled run (~00:44 UTC
2026-10-06) — verify read-only then.

---

## GLAMA PICKED UP /api/mcp WORDING — DISAMBIGUATION 2/5 → 4/5 — 2026-10-04

**Checked (2026-10-04 ~14:20 UTC, read-only page fetch).** Glama's connector
`io.github.agenttrust-ai/agenttrust` re-tested `/api/mcp` at 13:44 UTC and
re-scored it at 13:50 UTC, both after the `969917f` deploy
(`dpl_5TG63ftgqMzKMyNTaNcNKCeZMHau`):
- `check_agent_trust` shows the new first sentence, "Pre-invocation trust
  check for an unknown AI agent or MCP server endpoint.", and now carries
  Read-only and Idempotent badges; Glama's scoring notes the annotations
  "already cover the safety profile (readOnly, idempotent,
  non-destructive)". No "preferred" remains on the page.
- `list_agents` shows the new last sentence, "Requires an API key; for an
  anonymous pre-invocation check use check_agent_trust."
- Overall quality A 3.9 → **A 4.1**; Disambiguation 2/5 → **4/5**; Naming
  Consistency 5/5, Tool Count 5/5, Completeness 4/5. The remaining
  disambiguation note: `check_agent_trust` and `list_agents` with
  `endpointUrl` overlap, but the descriptions clarify the difference
  (anonymous vs API key), so confusion is limited.
- Uptime 100% over 16 days.

**Unchanged on Glama.** Still only `https://getagenttrust.com/api/mcp`
(5 tools); `/api/mcp/public` does not appear — it has not followed the
registry 1.0.4 remote order. Less important now that `/api/mcp` carries
the same wording and annotations.

**Next.** No product change. Smithery still serves its stored old copy
until re-scanned from the owner's Smithery account.

---

## llms.txt AND README POINT AT /api/mcp/public — 2026-10-04

**Why.** The discovery audit found that `llms.txt` and the README — what
an AI reads when it lands on the site or the repo — named only
`/api/mcp`, never `/api/mcp/public`, never said "MCP server", and
`llms.txt` still called `check_agent_trust` "the preferred check".

**What.** `747eaca`, docs only:
- `public/llms.txt` summary: "Before invoking an unknown AI agent or MCP
  server, call check_agent_trust with its exact endpoint URL …" (was
  "an unknown agent … with its endpoint URL").
- `public/llms.txt` MCP section: new first line "No-auth endpoint with
  only check_agent_trust: `https://getagenttrust.com/api/mcp/public`
  (Streamable HTTP)."; the `check_agent_trust` entry now reads
  "pre-invocation trust check for an unknown AI agent or MCP server
  endpoint" instead of "the preferred check before invoking an unknown
  external agent".
- `README.md`: the anonymous-check section now points at
  `https://getagenttrust.com/api/mcp/public` (no key; also available at
  `/api/mcp`).
- `src/lib/discovery/llms-txt.test.ts`: one new test pins these facts.
  918/918 tests, typecheck, lint, build passed.

**Verified live (read-only).** Deploy `dpl_8zGhB7XMHNumM8HKLaT1UwQPQ1tk`
READY. `https://getagenttrust.com/llms.txt` returns 200 `text/plain`,
byte-identical to the committed file, no "preferred" left. GitHub `main`
is `747eaca`, changing exactly the three files above; its README is
byte-identical to the committed one. `/api/mcp/public` `tools/list`
still returns only `check_agent_trust` with the same wording.

**Unchanged.** Code, tool metadata, pinned `/api/mcp` snapshots, schemas,
auth, registry version, listings, production data. Two old phrasings are
left deliberately, outside this change: the `/api/mcp` server
instructions ("Before invoking an unknown agent endpoint, call
check_agent_trust … Only proceed …", pinned in `initialize.json`) and
`/docs` ("The preferred check before invoking an unknown external
agent").

**Measurement.** Weak: request logs count path hits, not user agents.
Daily `/llms.txt` fetches and the share of `/api/mcp/public` connections
are rough indicators only.

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
