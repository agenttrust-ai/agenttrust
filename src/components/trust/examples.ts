import { trustReportFromEvidence, type TrustEvidence } from "./report-data";

/** The fictional endpoint used by every illustrative example. */
export const EXAMPLE_ENDPOINT = "https://agent.example.com/a2a";

/**
 * An illustrative result in exactly the shape `check_agent_trust` returns.
 * The `trustDecision` is never hand-written: it comes from the same
 * `computeTrustDecision` the live check uses, so examples can't drift from
 * the real rules. Names and endpoints must be fictional.
 */
export function exampleResult(input: TrustEvidence) {
  return trustReportFromEvidence(input);
}

/** The canonical "healthy, current, verified" example. */
export const PRIMARY_EXAMPLE = exampleResult({
  name: "Example Agent",
  slug: "example-agent",
  status: "healthy",
  score: 96,
  scoreStatus: "fresh",
  verified: true,
});
