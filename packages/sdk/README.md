# @getagenttrust/sdk

The official SDK for [AgentTrust](https://getagenttrust.com) at **getagenttrust.com**: check an AI agent or MCP server endpoint **before you connect to it**.

> **Not affiliated** with agenttrust.ai or the `@agenttrust` npm scope — those are a different, unrelated project. This SDK is published only as **`@getagenttrust/sdk`**.

AgentTrust monitors AI agents and MCP servers and returns a trust decision for an exact endpoint URL: its observed status, reliability score, endpoint-ownership verification and a `trustDecision` (`recommended`, `confidence`, `reasons`). The check is anonymous and read-only — no account or API key — and **AgentTrust never contacts the endpoint you ask about**.

## Install

```bash
npm install @getagenttrust/sdk
```

No dependencies. ESM only.

### Supported runtimes

- **Node.js 18 or later.**
- Other **server-side** JavaScript runtimes that provide a standard global `fetch` (for example Deno, Bun, or serverless and edge functions) should work, but only Node.js is tested. If your runtime has no global `fetch`, pass one in with the `fetch` option.
- **Browsers are not currently supported or tested.** Browsers can't set the `User-Agent` header the SDK sends, and cross-origin access to AgentTrust from a web page hasn't been verified. Run trust checks from your server or agent backend.

## Check an endpoint

```ts
import { checkAgentTrust } from "@getagenttrust/sdk";

const result = await checkAgentTrust("https://mcp.example.com/mcp");

if (result.matched) {
  console.log(result.status, result.reliabilityScore, result.trustDecision);
  // "healthy" 100 { recommended: true, confidence: "high", reasons: [] }
} else {
  // AgentTrust has no data for this endpoint yet. It may be queued for
  // observation: result.observation?.status is "pending", "observing" or
  // "not_in_registry". An unmatched result never carries a score.
}
```

## Only connect if it's trusted

`assertTrusted` throws `NotTrustedError` unless the endpoint meets your policy, and **fails closed**: an endpoint AgentTrust doesn't know is rejected unless you allow it.

```ts
import { assertTrusted, NotTrustedError } from "@getagenttrust/sdk";

try {
  await assertTrusted("https://mcp.example.com/mcp", {
    requireRecommended: true, // default
    minConfidence: "medium",
    requireVerified: false,
    minReliabilityScore: 80,
    allowUnknown: false, // default
  });
  // connect with your MCP client here
} catch (error) {
  if (error instanceof NotTrustedError) {
    console.log("Not connecting:", error.failures);
  } else {
    throw error; // couldn't get a decision — treat as untrusted
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

A full trust gate in front of an MCP connection is in [`examples/check-before-connect.ts`](https://github.com/agenttrust-ai/agenttrust/blob/main/packages/sdk/examples/check-before-connect.ts).

## Options

```ts
import { createAgentTrustClient } from "@getagenttrust/sdk";

const agentTrust = createAgentTrustClient({
  timeoutMs: 5_000, // default 10_000
  // endpoint: "https://getagenttrust.com/api/mcp/public", // default
  // fetch: customFetch,
  // userAgent: "my-agent/1.0",
});

await agentTrust.checkAgentTrust(url, { timeoutMs: 2_000, signal });
```

## Errors

Everything the SDK throws is an `AgentTrustError` with a `code`:

| `code` | When |
|---|---|
| `INVALID_URL` | Not an absolute `http://` or `https://` URL. No request is made. |
| `RATE_LIMITED` | AgentTrust's anonymous limit (10 checks/minute per IP) was reached. `retryAfterSeconds` says when to retry. The SDK never retries on its own. |
| `TIMEOUT` / `ABORTED` | The timeout elapsed, or your `signal` aborted. |
| `NETWORK_ERROR` | AgentTrust couldn't be reached. |
| `HTTP_ERROR` | A non-2xx response; see `status`. |
| `PROTOCOL_ERROR` | The response wasn't a valid MCP / `check_agent_trust` result. |
| `TOOL_ERROR` | The tool reported an error (e.g. input the server rejected). |
| `NOT_TRUSTED` | `NotTrustedError` from `assertTrusted`; see `failures` and `result`. |

## Unknown endpoints

AgentTrust only has data for endpoints it monitors. For any other URL, `checkAgentTrust` returns `{ matched: false }`, possibly with an `observation` status if AgentTrust has queued it for a lookup in the official MCP Registry. Because `assertTrusted` fails closed, an unknown endpoint is rejected unless you pass `allowUnknown: true` — decide deliberately which behaviour your agent needs, and consider asking a human before connecting to an unknown server.

## What a trust decision is — and isn't

A `trustDecision` is a signal derived from AgentTrust's own monitoring (reachability checks, a reliability score over the last 7 days, and ownership verification). It is not a certification, a security audit or a guarantee of safety. Most endpoints are not ownership-verified, so `confidence` is often `"low"` even when `recommended` is `true`.

## How it works

The SDK sends one [MCP](https://modelcontextprotocol.io) `tools/call` for AgentTrust's `check_agent_trust` tool to `https://getagenttrust.com/api/mcp/public` over stateless Streamable HTTP, and validates the result. The same tool is available to MCP clients directly — see [getagenttrust.com/docs](https://getagenttrust.com/docs).
