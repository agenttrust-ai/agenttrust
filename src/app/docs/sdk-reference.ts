/**
 * The TypeScript SDK facts the /docs page shows. Kept out of page.tsx (a page
 * module can't export anything else) so tests can check them against the SDK
 * source and the SDK README: each code example here must appear verbatim in
 * packages/sdk/README.md, whose TypeScript blocks are compiled by
 * packages/sdk/src/readme.test.ts.
 */

export const SDK_PACKAGE = "@getagenttrust/sdk";
export const SDK_INSTALL = `npm install ${SDK_PACKAGE}`;
export const SDK_NPM_URL = "https://www.npmjs.com/package/@getagenttrust/sdk";
export const SDK_README_URL =
  "https://github.com/agenttrust-ai/agenttrust/tree/main/packages/sdk#readme";
export const SDK_EXAMPLE_URL =
  "https://github.com/agenttrust-ai/agenttrust/blob/main/packages/sdk/examples/check-before-connect.ts";

/** AgentTrust's own monitored test agent — the same live example the home page uses. */
export const SDK_EXAMPLE_ENDPOINT =
  "https://agenttrust-umber.vercel.app/api/test-agent";

export const SDK_CHECK_EXAMPLE = `import { checkAgentTrust } from "@getagenttrust/sdk";

// AgentTrust's own test agent: a real, monitored endpoint you can check.
const result = await checkAgentTrust("${SDK_EXAMPLE_ENDPOINT}");

if (result.matched) {
  console.log(result.status, result.reliabilityScore, result.trustDecision);
  // e.g. "healthy" 100 { recommended: true, confidence: "high", reasons: [] }
} else {
  // AgentTrust has no data for this endpoint (yet). An unmatched result never
  // carries a score; result.observation may say it was queued for a lookup.
  console.log("Unknown endpoint", result.observation?.status);
}`;

export const SDK_ASSERT_EXAMPLE = `import { assertTrusted, NotTrustedError } from "@getagenttrust/sdk";

const endpointUrl = "${SDK_EXAMPLE_ENDPOINT}";

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
}`;

/** Every `TrustPolicy` option, in the SDK's order. */
export const SDK_POLICY_OPTIONS: {
  name: string;
  defaultValue?: string;
  meaning: string;
}[] = [
  {
    name: "requireRecommended",
    defaultValue: "true",
    meaning: "Require AgentTrust's own trustDecision.recommended.",
  },
  {
    name: "minConfidence",
    meaning: 'Minimum trustDecision.confidence: "low", "medium" or "high".',
  },
  {
    name: "requireVerified",
    defaultValue: "false",
    meaning: "Require proven endpoint ownership.",
  },
  {
    name: "minReliabilityScore",
    meaning:
      "Minimum reliability score (0–100); a missing or stale score fails it.",
  },
  {
    name: "allowUnknown",
    defaultValue: "false",
    meaning: "Accept an endpoint AgentTrust has no data for.",
  },
];

/** Every `AgentTrustErrorCode`, in the SDK's order. */
export const SDK_ERROR_CODES: { code: string; meaning: string }[] = [
  {
    code: "INVALID_URL",
    meaning:
      "not an absolute http(s) URL, or it contains a username or password; no request is made",
  },
  {
    code: "RATE_LIMITED",
    meaning: "the anonymous limit was reached; see retryAfterSeconds",
  },
  { code: "TIMEOUT", meaning: "no answer within timeoutMs" },
  { code: "ABORTED", meaning: "your AbortSignal aborted the check" },
  { code: "NETWORK_ERROR", meaning: "AgentTrust couldn't be reached" },
  { code: "HTTP_ERROR", meaning: "a non-2xx response; see status" },
  {
    code: "PROTOCOL_ERROR",
    meaning: "the response wasn't a valid check_agent_trust result",
  },
  { code: "TOOL_ERROR", meaning: "the tool rejected the input" },
  {
    code: "NOT_TRUSTED",
    meaning: "NotTrustedError from assertTrusted; see failures and result",
  },
];
