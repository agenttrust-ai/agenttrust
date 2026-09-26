import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReliabilityScoreBadge } from "./reliability-score";

function render(props: Parameters<typeof ReliabilityScoreBadge>[0]): string {
  return renderToStaticMarkup(createElement(ReliabilityScoreBadge, props));
}

describe("ReliabilityScoreBadge", () => {
  it("labels a stale score 'Out of date' with its historical value, never with a current-verdict band", () => {
    const html = render({ score: 97, status: "stale" });
    expect(html).toContain("Out of date");
    expect(html).toContain("last 97/100");
    expect(html).not.toContain("Excellent");
    expect(html).not.toContain("green");
  });

  it("renders a fresh score exactly as before (band label and color)", () => {
    expect(render({ score: 97, status: "fresh" })).toBe(render({ score: 97 }));
    expect(render({ score: 97 })).toContain("Excellent");
  });

  it("renders no score as 'Not enough data yet', with or without a status", () => {
    expect(render({ score: null, status: "none" })).toContain("Not enough data yet");
    expect(render({ score: null })).toContain("Not enough data yet");
  });
});
