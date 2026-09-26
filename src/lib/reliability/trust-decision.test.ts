import { describe, expect, it } from "vitest";
import { computeTrustDecision, STALE_SCORE_REASON } from "./trust-decision";

describe("computeTrustDecision", () => {
  it("recommends a healthy, high-scoring, verified agent with high confidence and no reasons", () => {
    const result = computeTrustDecision({ status: "healthy", score: 95, verified: true });
    expect(result).toEqual({ recommended: true, confidence: "high", reasons: [] });
  });

  it("does not recommend an unhealthy agent, and explains why, regardless of score/verification", () => {
    const result = computeTrustDecision({ status: "down", score: 95, verified: true });
    expect(result.recommended).toBe(false);
    expect(result.reasons).toContain('Current status is "down", not healthy.');
  });

  it("does not recommend a degraded agent", () => {
    const result = computeTrustDecision({ status: "degraded", score: 80, verified: true });
    expect(result.recommended).toBe(false);
  });

  it("treats null score (insufficient monitoring history) as not recommended, with insufficient_data confidence", () => {
    const result = computeTrustDecision({ status: "healthy", score: null, verified: true });
    expect(result.recommended).toBe(false);
    expect(result.confidence).toBe("insufficient_data");
    expect(result.reasons).toContain(
      "Not enough monitoring history yet to compute a reliability score.",
    );
  });

  it("does not recommend a healthy agent with a low score, and explains why", () => {
    const result = computeTrustDecision({ status: "healthy", score: 30, verified: true });
    expect(result.recommended).toBe(false);
    expect(result.reasons).toContain("Reliability score is low (30/100).");
  });

  it("recommends right at the score threshold (boundary is inclusive)", () => {
    const result = computeTrustDecision({ status: "healthy", score: 50, verified: true });
    expect(result.recommended).toBe(true);
  });

  it("does not recommend just below the score threshold", () => {
    const result = computeTrustDecision({ status: "healthy", score: 49.99, verified: true });
    expect(result.recommended).toBe(false);
  });

  // The core policy requirement: verification is NOT a hard gate.
  it("still recommends an unverified agent when health and score are strong enough", () => {
    const result = computeTrustDecision({ status: "healthy", score: 92, verified: false });
    expect(result.recommended).toBe(true);
  });

  it("downgrades confidence for an unverified agent even when the score is excellent", () => {
    const verified = computeTrustDecision({ status: "healthy", score: 95, verified: true });
    const unverified = computeTrustDecision({ status: "healthy", score: 95, verified: false });
    expect(verified.confidence).toBe("high");
    expect(unverified.confidence).toBe("low");
    expect(unverified.recommended).toBe(true); // still recommended -- not a hard gate
  });

  it("always includes an explicit reason when unverified, regardless of the rest", () => {
    const result = computeTrustDecision({ status: "healthy", score: 95, verified: false });
    expect(result.reasons).toContain("Endpoint ownership has not been verified.");
  });

  it("includes no verification-related reason when verified", () => {
    const result = computeTrustDecision({ status: "healthy", score: 95, verified: true });
    expect(result.reasons.some((r) => r.toLowerCase().includes("ownership"))).toBe(false);
  });

  it("assigns medium confidence for a verified agent with a middling score", () => {
    const result = computeTrustDecision({ status: "healthy", score: 60, verified: true });
    expect(result.confidence).toBe("medium");
  });

  it("assigns low confidence for a verified agent with a poor score", () => {
    const result = computeTrustDecision({ status: "healthy", score: 10, verified: true });
    expect(result.confidence).toBe("low");
  });

  it("can report multiple reasons at once", () => {
    const result = computeTrustDecision({ status: "down", score: 20, verified: false });
    expect(result.reasons.length).toBe(3);
  });

  it("is deterministic — identical input always produces identical output", () => {
    const input = { status: "healthy" as const, score: 77, verified: false };
    expect(computeTrustDecision(input)).toEqual(computeTrustDecision(input));
  });
});

describe("computeTrustDecision — score freshness", () => {
  it("never recommends on a stale score, however high — and says so with the stale reason", () => {
    const result = computeTrustDecision({
      status: "healthy",
      score: 97,
      verified: true,
      scoreStatus: "stale",
    });
    expect(result.recommended).toBe(false);
    expect(result.confidence).toBe("insufficient_data");
    expect(result.reasons).toEqual([STALE_SCORE_REASON]);
  });

  it("gives a stale low score only the stale reason, not a 'score is low' verdict on old data", () => {
    const result = computeTrustDecision({
      status: "healthy",
      score: 20,
      verified: false,
      scoreStatus: "stale",
    });
    expect(result.recommended).toBe(false);
    expect(result.reasons).toContain(STALE_SCORE_REASON);
    expect(result.reasons.some((r) => r.startsWith("Reliability score is low"))).toBe(false);
  });

  it("keeps the stale reason distinct from the 'no score yet' reason", () => {
    const none = computeTrustDecision({ status: "healthy", score: null, verified: true, scoreStatus: "none" });
    expect(none.reasons).toContain("Not enough monitoring history yet to compute a reliability score.");
    expect(none.reasons).not.toContain(STALE_SCORE_REASON);
  });

  it("treats an explicit 'fresh' score exactly like the pre-freshness behavior", () => {
    for (const input of [
      { status: "healthy" as const, score: 95, verified: true },
      { status: "healthy" as const, score: 70, verified: false },
      { status: "degraded" as const, score: 95, verified: true },
      { status: "healthy" as const, score: 30, verified: true },
    ]) {
      expect(computeTrustDecision({ ...input, scoreStatus: "fresh" })).toEqual(
        computeTrustDecision(input),
      );
    }
  });

  it("still reports an unhealthy status alongside a stale score", () => {
    const result = computeTrustDecision({
      status: "down",
      score: 97,
      verified: true,
      scoreStatus: "stale",
    });
    expect(result.recommended).toBe(false);
    expect(result.reasons).toContain('Current status is "down", not healthy.');
    expect(result.reasons).toContain(STALE_SCORE_REASON);
  });
});
