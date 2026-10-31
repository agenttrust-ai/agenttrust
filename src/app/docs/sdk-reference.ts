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

/**
 * "First 5 minutes": one walkthrough shown in README.md, the SDK README,
 * /docs and /llms.txt. src/lib/discovery/first-five-minutes.test.ts checks
 * that all four carry this text and that its facts match the SDK and the
 * assessment code.
 */

/** `assessAgent` needs SDK 0.2.0 or later. */
export const SDK_INSTALL_FIRST_STEPS = `npm install ${SDK_PACKAGE}@^0.2.0`;

export const SDK_FIRST_STEPS_EXAMPLE = `import { assessAgent } from "@getagenttrust/sdk";

// AgentTrust's own monitored test agent. Swap in the URL your agent is about to call.
const assessment = await assessAgent("${SDK_EXAMPLE_ENDPOINT}");

console.log(assessment.decision, assessment.confidence, assessment.reasonCodes);
// e.g. allow_with_caution high ["OWNERSHIP_VERIFIED", "REACHABLE_AT_LAST_CHECK", …]

if (assessment.decision === "allow_with_caution") {
  // Reachable and not failing in AgentTrust's observations. Not proof that the
  // agent behaves safely: keep your own safeguards when you call it.
} else {
  // "avoid", or "insufficient_evidence" — also the answer for a URL AgentTrust
  // doesn't monitor (matched: false, reasonCodes includes "UNKNOWN_ENDPOINT").
  console.log("Not calling it:", assessment.limitations);
}`;

/** Every `assessAgent` decision, in the SDK's order: what it means, what to do. */
export const SDK_DECISION_GUIDE: {
  decision: string;
  meaning: string;
  action: string;
}[] = [
  {
    decision: "allow_with_caution",
    meaning:
      "AgentTrust's observations show the endpoint reachable and not failing: a current historical reliability score, or at least two successful observations at least 10 minutes apart.",
    action:
      "Call it, with your own safeguards. It isn't proof that the agent behaves safely.",
  },
  {
    decision: "avoid",
    meaning:
      "AgentTrust's observations show it failing — for example two or more consecutive failures, or a current reliability score below 50.",
    action: "Don't call it.",
  },
  {
    decision: "insufficient_evidence",
    meaning:
      "Not enough evidence either way: an endpoint AgentTrust doesn't monitor, too few or too old observations, or a single failure that may be temporary.",
    action: "Don't treat it as approval — handle it as an unknown endpoint.",
  },
];

/** Which SDK call to use. Backticks mark code. */
export const SDK_CALL_GUIDE: { call: string; when: string; returns: string }[] =
  [
    {
      call: "assessAgent(url)",
      when: "Your agent needs one decision to act on before it calls an endpoint.",
      returns:
        "`decision`, `confidence`, `reasonCodes` and `limitations`, with the evidence behind them.",
    },
    {
      call: "checkAgentTrust(url)",
      when: "You want the evidence itself — `status`, `reliabilityScore`, `verified` and `trustDecision` — to apply your own rules.",
      returns:
        "`{ matched: true, … }`, or `{ matched: false }` for an endpoint AgentTrust doesn't monitor.",
    },
    {
      call: "assertTrusted(url, policy)",
      when: "You want a gate: go ahead only if the endpoint meets your policy.",
      returns: "The `checkAgentTrust` result, or a thrown `NotTrustedError`.",
    },
  ];

/** Said under the call guide: what all three calls are, and aren't. */
export const SDK_CALL_GUIDE_NOTE =
  "All three are anonymous and read-only, and never contact the endpoint (over MCP: `assess_agent` and `check_agent_trust`). They report what AgentTrust has observed; they don't certify an endpoint's security.";

/** What an unknown endpoint looks like, and how to handle it. Backticks mark code. */
export const SDK_UNKNOWN_ENDPOINT = {
  intro:
    "AgentTrust only has evidence for endpoints it monitors, so your first check of a real URL may come back unknown. That is an answer, not an API failure — the call succeeds:",
  results: [
    '`assessAgent` returns `matched: false`, `decision: "insufficient_evidence"`, `confidence: "none"`, and `reasonCodes` including `"UNKNOWN_ENDPOINT"`.',
    "`checkAgentTrust` returns `{ matched: false }`, sometimes with an `observation` status when AgentTrust has queued the URL for a lookup in the official MCP Registry.",
    '`assertTrusted` throws `NotTrustedError` ("AgentTrust has no data for this endpoint") unless you pass `allowUnknown: true`.',
  ],
  errors:
    "Real failures — `RATE_LIMITED`, `TIMEOUT`, `NETWORK_ERROR` and the rest — throw an `AgentTrustError` instead.",
  handling:
    'Handle an unknown endpoint as not trusted: don\'t map `insufficient_evidence` to "allow", keep `allowUnknown: false` (the default) unless you have chosen otherwise on purpose, and ask a human or run your own checks before calling an endpoint nobody has observed.',
};

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
