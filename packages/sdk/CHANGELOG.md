# Changelog

All notable changes to `@getagenttrust/sdk` are documented here. This project follows [Semantic Versioning](https://semver.org); while the version is `0.x`, minor releases may include breaking changes.

## 0.1.2

### Security

- `assertTrusted` and `evaluatePolicy` now throw `TypeError`, before any request, when `allowUnknown`, `requireRecommended` or `requireVerified` is anything other than `true`, `false` or unset. They were read as truthy or falsy, so a value such as `allowUnknown: "false"` (for example from an environment variable) accepted unknown endpoints, and `requireRecommended: ""` or `0` accepted endpoints AgentTrust doesn't recommend. A policy that isn't an object also throws `TypeError`.
- `checkAgentTrust` and `assertTrusted` reject an endpoint URL that contains a username or password with `INVALID_URL`, instead of sending those credentials to AgentTrust. The error message doesn't repeat them.

### Fixed

- An HTTP 429 response is reported as `RATE_LIMITED` (with `status: 429`) instead of `HTTP_ERROR`. `retryAfterSeconds` is read from the `Retry-After` header, as a number of seconds or an HTTP date; any other value is ignored.
- A rate limit reported by the tool no longer turns a missing or invalid `retryAfterSeconds` into `0`.
- `require("@getagenttrust/sdk")` works on Node.js versions that can `require()` ES modules (20.19+ and 22.12+). It used to fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`.

### Changed

- `createAgentTrustClient` throws `TypeError` for options that could never work: an `endpoint` that isn't an absolute `http://` or `https://` URL or that contains credentials, a `timeoutMs` that isn't a finite number greater than 0 (up to 2147483647), a `fetch` that isn't a function, or a `userAgent` that `fetch` can't send as a header (line breaks, or characters outside Latin-1). A per-call `timeoutMs` or `signal` that's invalid rejects with `TypeError` before any request. These used to fail on every check instead, often as an immediate `TIMEOUT` or a misleading `NETWORK_ERROR`.

Valid policies, options and results behave exactly as in 0.1.1.

## 0.1.1

### Changed

- First release published from GitHub Actions through npm Trusted Publishing, with a provenance attestation linking the package to its source commit in `agenttrust-ai/agenttrust`. No stored npm tokens are used to publish.
- The `User-Agent` sent with each check now reports `agenttrust-sdk/0.1.1`.

No functional or API changes since 0.1.0.

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
