import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReliabilityScoreBadge } from "./reliability-score";
import {
  SCORE_THRESHOLD_HIGH_CONFIDENCE,
  SCORE_THRESHOLD_RECOMMENDED,
} from "@/lib/reliability/scoring";

function render(props: Parameters<typeof ReliabilityScoreBadge>[0]): string {
  return renderToStaticMarkup(createElement(ReliabilityScoreBadge, props));
}

function toneOf(html: string): string | undefined {
  return /data-tone="([a-z]+)"/.exec(html)?.[1];
}

describe("ReliabilityScoreBadge", () => {
  it("labels a stale score 'Out of date' with its historical value, never with a current-verdict band or tone", () => {
    const html = render({ score: 97, status: "stale" });
    expect(html).toContain("Out of date");
    expect(html).toContain("last 97/100");
    expect(html).not.toContain("Excellent");
    expect(toneOf(html)).toBe("neutral");
    expect(html).not.toMatch(/text-(positive|negative|caution)\b/);
  });

  it("renders a fresh score exactly as before (band label and tone)", () => {
    expect(render({ score: 97, status: "fresh" })).toBe(render({ score: 97 }));
    expect(render({ score: 97 })).toContain("Excellent");
  });

  it("renders no score as 'Not enough data yet', neutral, with or without a status", () => {
    expect(render({ score: null, status: "none" })).toContain("Not enough data yet");
    expect(render({ score: null })).toContain("Not enough data yet");
    expect(toneOf(render({ score: null }))).toBe("neutral");
  });

  describe("bands follow the backend thresholds only", () => {
    it("uses the backend's own threshold values (50 recommended, 90 high confidence)", () => {
      expect(SCORE_THRESHOLD_RECOMMENDED).toBe(50);
      expect(SCORE_THRESHOLD_HIGH_CONFIDENCE).toBe(90);
    });

    it.each([
      [100, "Excellent", "positive"],
      [SCORE_THRESHOLD_HIGH_CONFIDENCE, "Excellent", "positive"],
      [SCORE_THRESHOLD_HIGH_CONFIDENCE - 1, "Good", "positive"],
      [75, "Good", "positive"],
      [74, "Good", "positive"],
      [SCORE_THRESHOLD_RECOMMENDED, "Good", "positive"],
      [SCORE_THRESHOLD_RECOMMENDED - 1, "Poor", "negative"],
      [0, "Poor", "negative"],
    ])("score %s → %s (%s)", (score, label, tone) => {
      const html = render({ score });
      expect(html).toContain(`${score}</span>`);
      expect(html).toContain(label);
      expect(toneOf(html)).toBe(tone);
    });

    it("has no UI-only band at 75 — 74 and 75 render identically apart from the number", () => {
      expect(render({ score: 74 }).replace("74", "N")).toBe(
        render({ score: 75 }).replace("75", "N"),
      );
    });

    it("never renders the removed 'Fair' band or a caution tone for a fresh score", () => {
      for (const score of [0, 25, 49, 50, 60, 74, 75, 89, 90, 100]) {
        const html = render({ score });
        expect(html).not.toContain("Fair");
        expect(toneOf(html)).not.toBe("caution");
      }
    });
  });
});
