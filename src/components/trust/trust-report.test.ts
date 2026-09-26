import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { computeTrustDecision, STALE_SCORE_REASON } from "@/lib/reliability/trust-decision";
import type { AgentHealthStatus } from "@/lib/monitoring/status";
import type { ReliabilityScoreStatus } from "@/lib/reliability/freshness";
import { NotMatchedReport, TrustReport, type TrustReportData } from "./trust-report";
import { reasonsHeading, verdictOf } from "./verdict";

function data(input: {
  status: AgentHealthStatus;
  score: number | null;
  scoreStatus: ReliabilityScoreStatus;
  verified: boolean;
}): TrustReportData {
  return {
    name: "Test Agent",
    slug: "test-agent",
    status: input.status,
    verified: input.verified,
    reliabilityScore: input.score,
    reliabilityScoreStatus: input.scoreStatus,
    trustDecision: computeTrustDecision(input),
  };
}

const render = (props: Parameters<typeof TrustReport>[0]) => renderToStaticMarkup(TrustReport(props));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/\s+/g, " ");

describe("verdictOf — presentation of the backend's own fields only", () => {
  it("maps insufficient_data to its own neutral verdict, regardless of `recommended`", () => {
    expect(verdictOf({ recommended: false, confidence: "insufficient_data", reasons: [] })).toMatchObject({
      kind: "insufficient_data",
      label: "Insufficient data",
      tone: "neutral",
    });
  });

  it("maps recommended to positive and anything else to negative", () => {
    for (const confidence of ["high", "medium", "low"] as const) {
      expect(verdictOf({ recommended: true, confidence, reasons: [] }).tone).toBe("positive");
      expect(verdictOf({ recommended: false, confidence, reasons: [] })).toMatchObject({
        kind: "not_recommended",
        label: "Not recommended",
        tone: "negative",
      });
    }
  });

  it("frames the reasons list by verdict", () => {
    expect(reasonsHeading("recommended", 0)).toBe("No caveats reported");
    expect(reasonsHeading("recommended", 1)).toBe("What limits confidence");
    expect(reasonsHeading("not_recommended", 2)).toBe("Why it isn't recommended");
    expect(reasonsHeading("insufficient_data", 1)).toBe("Why there isn't enough evidence");
  });
});

describe("TrustReport — renders exactly what the backend decided", () => {
  const cases = [
    {
      name: "recommended, verified, high",
      input: { status: "healthy", score: 96, scoreStatus: "fresh", verified: true } as const,
      verdict: "Recommended",
      confidence: "High",
      evidence: ["Healthy", "Excellent", "Current", "Verified"],
    },
    {
      name: "recommended, unverified, low",
      input: { status: "healthy", score: 88, scoreStatus: "fresh", verified: false } as const,
      verdict: "Recommended",
      confidence: "Low",
      evidence: ["Healthy", "Good", "Current", "Not verified"],
    },
    {
      name: "not recommended — down with a low score",
      input: { status: "down", score: 42, scoreStatus: "fresh", verified: true } as const,
      verdict: "Not recommended",
      confidence: "Low",
      evidence: ["Down", "Poor", "Current", "Verified"],
    },
    {
      name: "not recommended — degraded despite a good score",
      input: { status: "degraded", score: 91, scoreStatus: "fresh", verified: true } as const,
      verdict: "Not recommended",
      confidence: "High",
      evidence: ["Degraded", "Excellent", "Current", "Verified"],
    },
    {
      name: "insufficient data — stale score",
      input: { status: "healthy", score: 97, scoreStatus: "stale", verified: false } as const,
      verdict: "Insufficient data",
      confidence: "Insufficient data",
      evidence: ["Healthy", "Out of date", "last 97/100", "Not verified"],
    },
    {
      name: "insufficient data — no score yet",
      input: { status: "unknown", score: null, scoreStatus: "none", verified: false } as const,
      verdict: "Insufficient data",
      confidence: "Insufficient data",
      evidence: ["Not yet monitored", "Not enough data yet", "No score yet", "Not verified"],
    },
  ];

  it.each(cases)("$name", ({ input, verdict, confidence, evidence }) => {
    const d = data(input);
    const out = text(render({ data: d }));
    expect(out).toContain(verdict);
    expect(out).toContain(`Confidence: ${confidence}`);
    for (const e of evidence) expect(out).toContain(e);
    // Every backend reason appears verbatim, and nothing is added.
    for (const reason of d.trustDecision.reasons) expect(out).toContain(reason);
    expect(out).toContain(`recommended: ${d.trustDecision.recommended}`);
    expect(out).toContain(`confidence: "${d.trustDecision.confidence}"`);
  });

  it("shows the stale-score reason and never presents a stale score as a current verdict", () => {
    const d = data({ status: "healthy", score: 97, scoreStatus: "stale", verified: true });
    const html = render({ data: d });
    expect(text(html)).toContain(STALE_SCORE_REASON);
    expect(text(html)).not.toContain("Excellent");
  });

  it("carries the verdict with an icon and text, not color alone", () => {
    const html = render({ data: data({ status: "down", score: 20, scoreStatus: "fresh", verified: false }) });
    expect(html).toContain("<svg");
    expect(text(html)).toContain("Not recommended");
  });

  it("renders the verdict larger than any evidence chip", () => {
    const html = render({ data: data({ status: "healthy", score: 96, scoreStatus: "fresh", verified: true }) });
    expect(html).toMatch(/class="text-title">Recommended</);
  });

  it("uses the requested heading level, and labels example data so it can't pass for a live lookup", () => {
    const d = data({ status: "healthy", score: 96, scoreStatus: "fresh", verified: true });
    const html = render({ data: d, headingLevel: "h3", example: true });
    expect(html).toMatch(/<h3[^>]*>Test Agent<\/h3>/);
    expect(text(html)).toContain("Example trust report");
    expect(text(render({ data: d }))).not.toContain("Example");
  });

  it("compact variant keeps verdict, confidence, chips and reasons but drops the evidence grid", () => {
    const d = data({ status: "healthy", score: 88, scoreStatus: "fresh", verified: false });
    const html = render({ data: d, compact: true, headingLevel: "h3" });
    expect(html).toMatch(/<h3[^>]*>Recommended<\/h3>/);
    expect(text(html)).toContain("Not verified");
    // No evidence grid (<dl>) — the reason text itself mentions "Endpoint
    // ownership", so check for the grid element, not the phrase.
    expect(html).not.toContain("<dl");
    expect(render({ data: d })).toContain("<dl");
    expect(text(html)).toContain("Endpoint ownership has not been verified.");
  });
});

describe("NotMatchedReport — { matched: false } is neutral, not a verdict", () => {
  it("says there is no evidence either way, never 'Not recommended', and shows the machine value", () => {
    const html = renderToStaticMarkup(NotMatchedReport({ endpointUrl: "https://unknown.example.com/a2a" }));
    const out = text(html);
    expect(out).toContain("No evidence for this endpoint");
    expect(out).toContain("not an error");
    expect(out).not.toContain("Not recommended");
    expect(out).not.toContain("Insufficient data");
    expect(out).toContain('{ "matched": false }');
    expect(out).toContain("https://unknown.example.com/a2a");
    // Neutral styling only — no positive/negative color classes (the copy
    // itself says "not a negative result", so match classes, not words).
    expect(html).not.toMatch(/(text|bg|border)-(negative|positive)/);
  });
});
