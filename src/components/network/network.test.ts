import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { computeTrustDecision } from "@/lib/reliability/trust-decision";
import type { AgentHealthStatus } from "@/lib/monitoring/status";
import type { ReliabilityScoreStatus } from "@/lib/reliability/freshness";
import { ResolutionTrace } from "@/components/check/resolution-trace";
import { trustReportFromEvidence } from "@/components/trust/report-data";
import { NetworkNode, nodeStateForAgent } from "./network-node";
import { EvidenceTraces, ObservedNetworkBackdrop } from "./observed-network";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("Observed Agent Network — decorative only", () => {
  it("keeps the hero backdrop and evidence traces out of the accessibility tree, with no text or live data", () => {
    for (const html of [
      renderToStaticMarkup(ObservedNetworkBackdrop()),
      renderToStaticMarkup(EvidenceTraces()),
    ]) {
      expect(html).toMatch(/^<[a-z]+ aria-hidden="true"/);
      expect(text(html)).toBe("");
    }
  });

  it("only animates behind the reduced-motion-gated classes", () => {
    const html = renderToStaticMarkup(EvidenceTraces());
    expect(html).toContain('class="at-signal"');
    expect(html).not.toMatch(/<animate/);
  });

  it("renders nodes as hidden decoration", () => {
    expect(renderToStaticMarkup(NetworkNode({ state: "healthy" }))).toContain('aria-hidden="true"');
  });

  it("maps agent health onto node states, drafts hollow and unknowns neutral", () => {
    expect(nodeStateForAgent("healthy")).toBe("healthy");
    expect(nodeStateForAgent("degraded")).toBe("degraded");
    expect(nodeStateForAgent("down")).toBe("down");
    expect(nodeStateForAgent("unknown")).toBe("unknown");
    expect(nodeStateForAgent("something-new")).toBe("unknown");
    expect(nodeStateForAgent("healthy", true)).toBe("draft");
  });
});

describe("ResolutionTrace — a directory lookup, never a live request", () => {
  it("describes resolution against existing observations and says the endpoint wasn't contacted", () => {
    for (const resolved of [true, false]) {
      const out = text(renderToStaticMarkup(ResolutionTrace({ resolved })));
      expect(out).toContain("No request was sent to the endpoint.");
      expect(out).not.toMatch(/scann|connecting|testing|probing/i);
    }
    expect(text(renderToStaticMarkup(ResolutionTrace({ resolved: false })))).toContain("No match");
  });
});

describe("trustReportFromEvidence — agent pages show exactly the API's decision", () => {
  const statuses: AgentHealthStatus[] = ["healthy", "degraded", "down", "unknown"];
  const scoreStates: [number | null, ReliabilityScoreStatus][] = [
    [null, "none"],
    [96, "fresh"],
    [42, "fresh"],
    [97, "stale"],
  ];

  it("passes the same inputs straight to computeTrustDecision for every combination", () => {
    for (const status of statuses) {
      for (const [score, scoreStatus] of scoreStates) {
        for (const verified of [true, false]) {
          const report = trustReportFromEvidence({ name: "A", slug: "a", status, score, scoreStatus, verified });
          expect(report.trustDecision).toEqual(computeTrustDecision({ status, score, verified, scoreStatus }));
          expect(report.reliabilityScore).toBe(score);
          expect(report.reliabilityScoreStatus).toBe(scoreStatus);
          expect(report.verified).toBe(verified);
        }
      }
    }
  });
});
