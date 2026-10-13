# Changelog

All notable changes to `@getagenttrust/sdk` are documented here. This project follows [Semantic Versioning](https://semver.org); while the version is `0.x`, minor releases may include breaking changes.

## 0.1.0

First release: check an AI agent or MCP server endpoint with [AgentTrust](https://getagenttrust.com) before connecting to it.

### Added

- `checkAgentTrust(endpointUrl, options?)` — looks up what AgentTrust has observed about an exact endpoint URL and returns a typed result: for a monitored endpoint its `status`, `verified`, `reliabilityScore`, `reliabilityScoreStatus` and `trustDecision` (`recommended`, `confidence`, `reasons`); for any other endpoint `{ matched: false }`, with an `observation` status when AgentTrust has queued it for a lookup in the MCP Registry. AgentTrust never contacts the endpoint being checked.
- `assertTrusted(endpointUrl, policy?, options?)` — throws `NotTrustedError` unless the endpoint meets a policy (`requireRecommended`, `minConfidence`, `requireVerified`, `minReliabilityScore`, `allowUnknown`). Fails closed: unknown endpoints are rejected unless `allowUnknown` is set, and unrecognised server values never satisfy a requirement. Invalid policies throw `TypeError` before any request.
- `evaluatePolicy(result, policy?)` — the same policy check on a result you already have.
- `createAgentTrustClient(options?)` — configurable `timeoutMs` (default 10 000), per-call `timeoutMs` and `signal`, custom `fetch`, and `userAgent`.
- Typed errors: every failure is an `AgentTrustError` with a `code` (`INVALID_URL`, `RATE_LIMITED` with `retryAfterSeconds`, `TIMEOUT`, `ABORTED`, `NETWORK_ERROR`, `HTTP_ERROR`, `PROTOCOL_ERROR`, `TOOL_ERROR`, `NOT_TRUSTED`).
- An example trust gate in front of an MCP connection (`examples/check-before-connect.ts` in the repository).

### Notes

- Anonymous, no API key: one MCP `tools/call` to `https://getagenttrust.com/api/mcp/public` per check. AgentTrust allows 10 anonymous checks per minute per IP address; the SDK reports `RATE_LIMITED` and never retries on its own.
- Node.js 18 or later; other server-side runtimes with a global `fetch` should work but only Node.js is tested. Browsers are not supported or tested.
- No runtime dependencies. ESM only.
