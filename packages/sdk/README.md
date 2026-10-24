# @getagenttrust/sdk

The official SDK for [AgentTrust](https://getagenttrust.com) at **getagenttrust.com**: check an AI agent or MCP server endpoint **before you connect to it**.

> **Not affiliated** with agenttrust.ai or the `@agenttrust` npm scope — those are a different, unrelated project. This SDK is published only as **`@getagenttrust/sdk`**.

AgentTrust monitors AI agents and MCP servers and returns a trust decision for an exact endpoint URL: its observed status, reliability score, endpoint-ownership verification and a `trustDecision` (`recommended`, `confidence`, `reasons`). The check is anonymous and read-only — no account or API key — and **AgentTrust never contacts the endpoint you ask about**.

## Install

```bash
npm install @getagenttrust/sdk
```

No dependencies. An ES module: use `import`, or `require()` on Node.js 20.19+ or 22.12+, which can load ES modules.

### Supported runtimes

- **Node.js 18 or later.**
- Other **server-side** JavaScript runtimes that provide a standard global `fetch` (for example Deno, Bun, or serverless and edge functions) should work, but only Node.js is tested. If your runtime has no global `fetch`, pass one in with the `fetch` option.
- **Browsers are not currently supported or tested.** Browsers can't set the `User-Agent` header the SDK sends, and cross-origin access to AgentTrust from a web page hasn't been verified. Run trust checks from your server or agent backend.

## Check an endpoint

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

The example checks `https://agenttrust-umber.vercel.app/api/test-agent`, AgentTrust's own monitored test agent, so it returns a real result you can try right away. AgentTrust never contacts the endpoint you check. The values in the comment are an example: a result reflects AgentTrust's latest monitoring.

## Only connect if it's trusted

`assertTrusted` throws `NotTrustedError` unless the endpoint meets your policy, and **fails closed**: an endpoint AgentTrust doesn't know is rejected unless you allow it. It returns the result it decided on.

```ts
import { assertTrusted, NotTrustedError } from "@getagenttrust/sdk";

const endpointUrl = "https://agenttrust-umber.vercel.app/api/test-agent";

try {
  await assertTrusted(endpointUrl, {
    requireRecommended: true, // default
    minConfidence: "medium",
    requireVerified: false, // default
    minReliabilityScore: 80,
    allowUnknown: false, // default
  });
  // Trusted: connect with your MCP client here.
} catch (error) {
  if (error instanceof NotTrustedError) {
    console.log("Not connecting:", error.failures);
  } else {
    throw error; // couldn't get a decision: treat the endpoint as untrusted
  }
}
```

| Policy option | Default | Meaning |
|---|---|---|
| `requireRecommended` | `true` | Require AgentTrust's own `trustDecision.recommended` (healthy, a current score of at least 50). |
| `minConfidence` | — | Minimum `trustDecision.confidence`: `"low"`, `"medium"` or `"high"`. |
| `requireVerified` | `false` | Require proven endpoint ownership. |
| `minReliabilityScore` | — | Minimum reliability score (0–100); a missing or stale score fails it. |
| `allowUnknown` | `false` | Accept an endpoint AgentTrust has no data for. |

The boolean options must be `true` or `false`: any other value, such as the string `"false"` from an environment variable, throws `TypeError` instead of being guessed at. So does any other invalid policy, before a request is made.

A full trust gate in front of an MCP connection is in [`examples/check-before-connect.ts`](https://github.com/agenttrust-ai/agenttrust/blob/main/packages/sdk/examples/check-before-connect.ts).

## Check a result you already have

`evaluatePolicy(result, policy?)` applies a policy to a result from `checkAgentTrust` without another request. It returns every requirement the result fails, in plain language; an empty array means it passes.

```ts
import { checkAgentTrust, evaluatePolicy } from "@getagenttrust/sdk";

const result = await checkAgentTrust("https://agenttrust-umber.vercel.app/api/test-agent");
const failures = evaluatePolicy(result, { requireVerified: true, minReliabilityScore: 90 });

if (failures.length === 0) {
  console.log("Meets the policy");
} else {
  console.log("Policy not met:", failures);
}
```

## Decide whether to call it

Requires `@getagenttrust/sdk` 0.2.0 or later.

`assessAgent(endpointUrl, options?)` returns a use-or-avoid decision your agent can act on immediately: `decision` is `allow_with_caution`, `avoid` or `insufficient_evidence`, with `confidence`, machine-readable `reasonCodes`, the latest stored `reachability` observation and its age, an `initialRisk` level, the unchanged `historical` score and `trustDecision`, `limitations` and `freshness`. Like `checkAgentTrust`, it is read-only and never contacts the endpoint.

```ts
import { assessAgent } from "@getagenttrust/sdk";

const assessment = await assessAgent("https://agenttrust-umber.vercel.app/api/test-agent");

switch (assessment.decision) {
  case "allow_with_caution":
    // Observed reachable and not failing — still not proof that its behavior is safe.
    console.log("Proceed carefully:", assessment.reasonCodes, assessment.limitations);
    break;
  case "avoid":
    console.log("Don't call it:", assessment.reasonCodes);
    break;
  case "insufficient_evidence":
    console.log("Not enough evidence yet:", assessment.reasonCodes);
    break;
}
```

`allow_with_caution` needs either a current historical reliability score or at least two successful observations at least 10 minutes apart — one successful check is never enough. Reachability is not safety: AgentTrust observes whether the endpoint answers, not what the agent does.

## Results

`checkAgentTrust` and `assertTrusted` resolve to a `TrustCheckResult`. Check `result.matched` first; TypeScript then narrows it to one of these:

| Field | Type | Meaning |
|---|---|---|
| `matched` | `true` | AgentTrust monitors this exact endpoint URL. |
| `slug` | `string` | The agent's AgentTrust identifier. |
| `name` | `string` | The agent's display name. |
| `status` | `"unknown" \| "healthy" \| "degraded" \| "down"` | Its latest observed status. |
| `verified` | `boolean` | Whether the endpoint's owner has proven control of its origin. |
| `reliabilityScore` | `number \| null` | 0–100, or `null` before there is enough monitoring history. |
| `reliabilityScoreStatus` | `"none" \| "fresh" \| "stale"` | Whether the score is current evidence. A stale score never makes an agent recommended. |
| `trustDecision.recommended` | `boolean` | AgentTrust's own recommendation. |
| `trustDecision.confidence` | `"high" \| "medium" \| "low" \| "insufficient_data"` | How much evidence is behind it. |
| `trustDecision.reasons` | `string[]` | Plain-language reasons for everything that counted against the agent; empty when nothing did. |

| Field | Type | Meaning |
|---|---|---|
| `matched` | `false` | AgentTrust has no data for this endpoint. It never carries a score or verification. |
| `observation` | `{ status: "pending" \| "observing" \| "not_in_registry"; message: string }` (optional) | Present when AgentTrust queued the endpoint for a lookup in the official MCP Registry. |

## Options

`createAgentTrustClient(options?)` returns a client with its own settings; `checkAgentTrust` and `assertTrusted` are its methods:

```ts
import { createAgentTrustClient } from "@getagenttrust/sdk";

const agentTrust = createAgentTrustClient({
  timeoutMs: 5_000, // default 10_000
  userAgent: "my-agent/1.0", // default "agenttrust-sdk/<version>"
  // endpoint: "https://getagenttrust.com/api/mcp/public", // default
  // fetch: customFetch, // default: the global fetch
});

const controller = new AbortController();
const result = await agentTrust.checkAgentTrust("https://agenttrust-umber.vercel.app/api/test-agent", {
  timeoutMs: 2_000, // overrides the client's timeout for this call
  signal: controller.signal, // controller.abort() cancels the check
});
console.log(result.matched);
```

## Errors

Invalid client options, per-call options or policies are programming errors: they throw a plain `TypeError`, before any request. Everything else the SDK throws is an `AgentTrustError` with a `code`:

| `code` | When |
|---|---|
| `INVALID_URL` | Not an absolute `http://` or `https://` URL, or it contains a username or password. No request is made. |
| `RATE_LIMITED` | AgentTrust's anonymous limit (10 checks/minute per IP) was reached. `retryAfterSeconds` says when to retry, when known. The SDK never retries on its own. |
| `TIMEOUT` / `ABORTED` | The timeout elapsed, or your `signal` aborted. |
| `NETWORK_ERROR` | AgentTrust couldn't be reached. |
| `HTTP_ERROR` | A non-2xx response; see `status`. |
| `PROTOCOL_ERROR` | The response wasn't a valid MCP / `check_agent_trust` result. |
| `TOOL_ERROR` | The tool reported an error (e.g. input the server rejected). |
| `NOT_TRUSTED` | `NotTrustedError` from `assertTrusted`; see `failures` and `result`. |

```ts
import { AgentTrustError, checkAgentTrust } from "@getagenttrust/sdk";

try {
  await checkAgentTrust("https://agenttrust-umber.vercel.app/api/test-agent");
} catch (error) {
  if (error instanceof AgentTrustError && error.code === "RATE_LIMITED") {
    console.log(`Rate limited; try again in ${error.retryAfterSeconds ?? 60}s`);
  } else {
    throw error;
  }
}
```

## Unknown endpoints

AgentTrust only has data for endpoints it monitors. For any other URL, `checkAgentTrust` returns `{ matched: false }`, possibly with an `observation` status if AgentTrust has queued it for a lookup in the official MCP Registry. Because `assertTrusted` fails closed, an unknown endpoint is rejected unless you pass `allowUnknown: true` — decide deliberately which behaviour your agent needs, and consider asking a human before connecting to an unknown server.

## What a trust decision is — and isn't

A `trustDecision` is a signal derived from AgentTrust's own monitoring (reachability checks, a reliability score over the last 7 days, and ownership verification). It is not a certification, a security audit or a guarantee of safety. Most endpoints are not ownership-verified, so `confidence` is often `"low"` even when `recommended` is `true`.

## How it works

The endpoint URL you pass, including any query string, is sent to AgentTrust to be looked up, so remove secrets such as API keys from it first. URLs with a username or password are rejected.

The SDK sends one [MCP](https://modelcontextprotocol.io) `tools/call` — for AgentTrust's `check_agent_trust` tool, or `assess_agent` for `assessAgent` — to `https://getagenttrust.com/api/mcp/public` over stateless Streamable HTTP, and validates the result. The same tools are available to MCP clients directly — see [getagenttrust.com/docs](https://getagenttrust.com/docs).
