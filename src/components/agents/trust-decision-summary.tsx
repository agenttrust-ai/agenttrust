import { StatusPill } from "./status-pill";
import { ReliabilityScoreBadge } from "./reliability-score";

export type TrustCheckResult = {
  matched: boolean;
  slug?: string;
  name?: string;
  status?: string;
  verified?: boolean;
  reliabilityScore?: number | null;
  trustDecision?: {
    recommended: boolean;
    confidence: "high" | "medium" | "low" | "insufficient_data";
    reasons: string[];
  };
};

type Verdict = { label: string; className: string };

/**
 * Presentation only — derived purely from the existing `trustDecision`
 * fields (`confidence`, `recommended`), never a new score or rule.
 * `insufficient_data` gets its own neutral state rather than folding into
 * "not recommended", since AgentTrust genuinely doesn't know either way
 * yet — collapsing that into "not recommended" would overstate what a
 * missing reliability score actually means.
 */
function getVerdict(
  trustDecision: NonNullable<TrustCheckResult["trustDecision"]>,
): Verdict {
  if (trustDecision.confidence === "insufficient_data") {
    return {
      label: "Insufficient data",
      className: "border-border bg-surface text-muted",
    };
  }
  if (trustDecision.recommended) {
    return {
      label: "Recommended",
      className:
        "border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-400",
    };
  }
  return {
    label: "Not recommended",
    className:
      "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400",
  };
}

/**
 * Renders exactly the shape `check_agent_trust` returns (matched or not) —
 * shared between the live result on /check-agent-trust and the homepage's
 * static, clearly-labeled illustrative example, so both ever describe the
 * same fields the MCP tool actually returns. The verdict banner is the
 * first thing rendered so the headline answer ("should I proceed?") never
 * gets buried under supporting detail.
 */
export function TrustDecisionSummary({ result }: { result: TrustCheckResult }) {
  if (!result.matched) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface p-4 text-sm text-muted">
        No agent is registered with this exact endpoint URL yet.
      </div>
    );
  }

  const { name, slug, status, verified, reliabilityScore, trustDecision } =
    result;
  const verdict = trustDecision ? getVerdict(trustDecision) : null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      {verdict && (
        <div
          className={`rounded-md border px-3 py-2 text-sm font-semibold ${verdict.className}`}
        >
          {verdict.label}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">{name}</p>
          <p className="font-mono text-xs text-muted">{slug}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {status && <StatusPill status={status} />}
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
              verified
                ? "border-accent/30 bg-accent/10 text-accent"
                : "border-border bg-surface text-muted"
            }`}
          >
            {verified ? "Endpoint verified" : "Endpoint not verified"}
          </span>
          <ReliabilityScoreBadge score={reliabilityScore ?? null} />
        </div>
      </div>
      {trustDecision && (
        <div className="rounded-md border border-border bg-background p-3 text-sm">
          <p className="font-mono text-xs text-muted">
            trustDecision · confidence: {trustDecision.confidence}
          </p>
          {trustDecision.reasons.length > 0 && (
            <ul className="mt-2 ml-4 list-disc space-y-0.5 text-muted">
              {trustDecision.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
