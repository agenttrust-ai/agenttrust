import { describe, expect, it } from "vitest";
import { computeTrustDecision } from "@/lib/reliability/trust-decision";
import type { AgentHealthStatus } from "@/lib/monitoring/status";
import type { ReliabilityScoreStatus } from "@/lib/reliability/freshness";
import {
  assessAgent,
  CACHED_EVIDENCE_LIMITATION,
  REACHABILITY_IS_NOT_SAFETY,
  type AssessmentAgentEvidence,
  type AssessmentObservation,
} from "./assess";

const NOW = new Date("2026-10-24T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const hoursAgo = (h: number) => minutesAgo(h * 60);

const ok = (at: Date): AssessmentObservation => ({
  checkedAt: at,
  success: true,
  checkStatus: "success",
  httpStatus: 200,
  latencyMs: 120,
});
const fail = (
  at: Date,
  checkStatus: AssessmentObservation["checkStatus"] = "connection_error",
): AssessmentObservation => ({
  checkedAt: at,
  success: false,
  checkStatus,
  httpStatus: checkStatus === "http_error" ? 503 : null,
  latencyMs: null,
});

function agent(
  overrides: {
    status?: AgentHealthStatus;
    score?: number | null;
    scoreStatus?: ReliabilityScoreStatus;
    verified?: boolean;
    source?: AssessmentAgentEvidence["source"];
    registeredAt?: Date;
  } = {},
): AssessmentAgentEvidence {
  const status = overrides.status ?? "healthy";
  const score = overrides.score === undefined ? null : overrides.score;
  const scoreStatus =
    overrides.scoreStatus ?? (score === null ? "none" : "fresh");
  const verified = overrides.verified ?? false;
  return {
    slug: "acme-bot",
    name: "Acme Bot",
    source: overrides.source ?? "owner_registered",
    verified,
    registeredAt: overrides.registeredAt ?? hoursAgo(24 * 30),
    historical: {
      status,
      reliabilityScore: score,
      reliabilityScoreStatus: scoreStatus,
      reliabilityScoreComputedAt: score === null ? null : hoursAgo(12),
      trustDecision: computeTrustDecision({
        status,
        score,
        verified,
        scoreStatus,
      }),
    },
  };
}

describe("assessAgent — never trusts without evidence", () => {
  it("an unknown endpoint is insufficient_evidence with no confidence", () => {
    const a = assessAgent({
      now: NOW,
      agent: null,
      observations: [ok(minutesAgo(1))],
    });
    expect(a).toMatchObject({
      matched: false,
      decision: "insufficient_evidence",
      confidence: "none",
      reasonCodes: ["UNKNOWN_ENDPOINT"],
      historical: null,
      agent: null,
      reachability: { outcome: "not_checked", checkedAt: null },
    });
    // Observations can't leak in for an unmatched endpoint.
    expect(a.initialRisk.observations.attempts).toBe(0);
  });

  it("a registered agent that was never checked is insufficient_evidence", () => {
    const a = assessAgent({ now: NOW, agent: agent(), observations: [] });
    expect(a.decision).toBe("insufficient_evidence");
    expect(a.reasonCodes).toContain("NOT_YET_CHECKED");
    expect(a.reachability.outcome).toBe("not_checked");
  });

  it("ONE successful observation is never enough for allow_with_caution", () => {
    const a = assessAgent({
      now: NOW,
      agent: agent(),
      observations: [ok(minutesAgo(5))],
    });
    expect(a.decision).toBe("insufficient_evidence");
    expect(a.confidence).toBe("none");
    expect(a.reasonCodes).toContain("FEW_OBSERVATIONS");
  });

  it("two successes less than 10 minutes apart are not enough", () => {
    const a = assessAgent({
      now: NOW,
      agent: agent(),
      observations: [ok(minutesAgo(1)), ok(minutesAgo(10))],
    });
    expect(a.initialRisk.observations.streakSpanMinutes).toBe(9);
    expect(a.decision).toBe("insufficient_evidence");
  });

  it("two independent successes 10+ minutes apart allow_with_caution, with low confidence", () => {
    const a = assessAgent({
      now: NOW,
      agent: agent(),
      observations: [ok(minutesAgo(1)), ok(minutesAgo(11))],
    });
    expect(a).toMatchObject({
      decision: "allow_with_caution",
      confidence: "low",
      initialRisk: {
        level: "elevated",
        observations: { successfulStreak: 2, streakSpanMinutes: 10 },
      },
    });
    expect(a.reasonCodes).toEqual(
      expect.arrayContaining([
        "INITIAL_OBSERVATIONS_ONLY",
        "NO_HISTORICAL_SCORE",
        "OWNERSHIP_UNVERIFIED",
      ]),
    );
  });

  it("only successes AFTER the last failure count toward the minimum", () => {
    const a = assessAgent({
      now: NOW,
      agent: agent(),
      observations: [
        ok(minutesAgo(1)),
        fail(minutesAgo(30)),
        ok(minutesAgo(120)),
      ],
    });
    expect(a.initialRisk.observations.successfulStreak).toBe(1);
    expect(a.decision).toBe("insufficient_evidence");
  });
});

describe("assessAgent — a single failure is not enough to avoid", () => {
  it.each([
    ["timeout", "LAST_CHECK_TIMEOUT", "TRANSIENT_NETWORK_FAILURE", "timeout"],
    [
      "dns_error",
      "LAST_CHECK_DNS_ERROR",
      "TRANSIENT_NETWORK_FAILURE",
      "unreachable",
    ],
    [
      "connection_error",
      "LAST_CHECK_CONNECTION_ERROR",
      "TRANSIENT_NETWORK_FAILURE",
      "unreachable",
    ],
    [
      "unknown_error",
      "UNREACHABLE_AT_LAST_CHECK",
      "TRANSIENT_NETWORK_FAILURE",
      "unreachable",
    ],
    [
      "http_error",
      "LAST_CHECK_HTTP_ERROR",
      "ENDPOINT_ERROR_RESPONSE",
      "unreachable",
    ],
  ] as const)(
    "one %s after successes is insufficient_evidence, never avoid or allow",
    (checkStatus, specific, kind, outcome) => {
      const a = assessAgent({
        now: NOW,
        agent: agent({ score: 99, verified: true }),
        observations: [
          fail(hoursAgo(2), checkStatus),
          ok(hoursAgo(26)),
          ok(hoursAgo(50)),
        ],
      });
      expect(a).toMatchObject({
        decision: "insufficient_evidence",
        confidence: "none",
        initialRisk: { level: "elevated" },
        reachability: { outcome },
      });
      expect(a.reasonCodes).toEqual(
        expect.arrayContaining(["UNREACHABLE_AT_LAST_CHECK", specific, kind]),
      );
      expect(a.reasonCodes).not.toContain("PERSISTENT_FAILURE");
    },
  );

  it("an agent whose only observation failed (transiently) is insufficient_evidence", () => {
    const a = assessAgent({
      now: NOW,
      agent: agent(),
      observations: [fail(minutesAgo(5), "timeout")],
    });
    expect(a.decision).toBe("insufficient_evidence");
    expect(a.reasonCodes).toContain("TRANSIENT_NETWORK_FAILURE");
  });
});

describe("assessAgent — avoid only for clearly justified high risk", () => {
  it.each(["connection_error", "timeout", "http_error"] as const)(
    "two consecutive failures (%s) are a persistent failure: avoid",
    (checkStatus) => {
      const a = assessAgent({
        now: NOW,
        agent: agent({ status: "degraded" }),
        observations: [
          fail(hoursAgo(1), checkStatus),
          fail(hoursAgo(25), checkStatus),
          ok(hoursAgo(49)),
        ],
      });
      expect(a).toMatchObject({
        decision: "avoid",
        confidence: "medium",
        initialRisk: { level: "high" },
      });
      expect(a.reasonCodes).toContain("PERSISTENT_FAILURE");
    },
  );

  it("four or more consecutive failures are avoid with high confidence", () => {
    const a = assessAgent({
      now: NOW,
      agent: agent({ status: "degraded" }),
      observations: [
        fail(hoursAgo(1)),
        fail(hoursAgo(13)),
        fail(hoursAgo(25)),
        fail(hoursAgo(37)),
      ],
    });
    expect(a).toMatchObject({ decision: "avoid", confidence: "high" });
  });

  it("historical status down with a failing latest check is avoid (high)", () => {
    const a = assessAgent({
      now: NOW,
      agent: agent({ status: "down", score: 80 }),
      observations: [fail(hoursAgo(1))],
    });
    expect(a).toMatchObject({ decision: "avoid", confidence: "high" });
    expect(a.reasonCodes).toEqual(
      expect.arrayContaining(["HISTORICAL_STATUS_DOWN", "PERSISTENT_FAILURE"]),
    );
  });

  it.each([
    ["ssrf_blocked", "LAST_CHECK_BLOCKED", "high", "blocked"],
    ["tls_error", "LAST_CHECK_TLS_ERROR", "medium", "unreachable"],
  ] as const)(
    "a deterministic failure (%s) is avoid even once",
    (checkStatus, reason, confidence, outcome) => {
      const a = assessAgent({
        now: NOW,
        agent: agent({ score: 99, verified: true }),
        observations: [
          fail(hoursAgo(2), checkStatus),
          ok(hoursAgo(26)),
          ok(hoursAgo(50)),
        ],
      });
      expect(a).toMatchObject({
        decision: "avoid",
        confidence,
        reachability: { outcome },
      });
      expect(a.reasonCodes).toContain(reason);
    },
  );

  it("a fresh historical score below 50 is avoid, even if the latest check succeeded", () => {
    const a = assessAgent({
      now: NOW,
      agent: agent({ score: 30 }),
      observations: [ok(hoursAgo(1)), ok(hoursAgo(25))],
    });
    expect(a).toMatchObject({ decision: "avoid", confidence: "high" });
    expect(a.reasonCodes).toContain("HISTORICAL_SCORE_LOW");
  });

  it.each(["down", "degraded"] as const)(
    "recovering from %s (latest check succeeded) is insufficient_evidence, not avoid",
    (status) => {
      const a = assessAgent({
        now: NOW,
        agent: agent({ status, score: 80 }),
        observations: [ok(hoursAgo(1)), fail(hoursAgo(25)), fail(hoursAgo(49))],
      });
      expect(a).toMatchObject({
        decision: "insufficient_evidence",
        initialRisk: { level: "elevated" },
      });
      expect(a.reasonCodes).toEqual(
        expect.arrayContaining([
          "RECOVERING",
          status === "down"
            ? "HISTORICAL_STATUS_DOWN"
            : "HISTORICAL_STATUS_DEGRADED",
        ]),
      );
    },
  );

  it("a failure streak only counts failures since the last success", () => {
    const a = assessAgent({
      now: NOW,
      agent: agent(),
      observations: [fail(hoursAgo(1)), ok(hoursAgo(13)), fail(hoursAgo(25))],
    });
    expect(a.decision).toBe("insufficient_evidence");
    expect(a.reasonCodes).not.toContain("PERSISTENT_FAILURE");
  });
});

describe("assessAgent — historical evidence", () => {
  it("sufficient fresh history (healthy, fresh score >= 50) allows with caution, mirroring trustDecision confidence", () => {
    const verified = assessAgent({
      now: NOW,
      agent: agent({ score: 95, verified: true }),
      observations: [ok(hoursAgo(3))],
    });
    expect(verified).toMatchObject({
      decision: "allow_with_caution",
      confidence: "high",
      initialRisk: { level: "low" },
    });
    expect(verified.reasonCodes).toContain("SUFFICIENT_HISTORY");

    const unverified = assessAgent({
      now: NOW,
      agent: agent({ score: 95, verified: false }),
      observations: [ok(hoursAgo(3))],
    });
    expect(unverified).toMatchObject({
      decision: "allow_with_caution",
      confidence: "low",
    });
  });

  it("a stale historical score is not sufficient history", () => {
    const a = assessAgent({
      now: NOW,
      agent: agent({ score: 95, scoreStatus: "stale" }),
      observations: [ok(hoursAgo(3))],
    });
    expect(a.decision).toBe("insufficient_evidence");
    expect(a.reasonCodes).toContain("HISTORICAL_SCORE_STALE");
  });

  it("evidence older than 50 hours is insufficient_evidence, whatever it said", () => {
    for (const observation of [ok(hoursAgo(51)), fail(hoursAgo(51))]) {
      const a = assessAgent({
        now: NOW,
        agent: agent({ score: 95, verified: true }),
        observations: [observation],
      });
      expect(a.decision).toBe("insufficient_evidence");
      expect(a.reasonCodes).toContain("STALE_EVIDENCE");
    }
  });

  it("returns the agent's trustDecision unchanged", () => {
    const evidence = agent({ score: 72, verified: true });
    const a = assessAgent({
      now: NOW,
      agent: evidence,
      observations: [ok(hoursAgo(1))],
    });
    expect(a.historical?.trustDecision).toEqual(
      evidence.historical.trustDecision,
    );
    expect(a.historical?.trustDecision).toEqual(
      computeTrustDecision({
        status: "healthy",
        score: 72,
        verified: true,
        scoreStatus: "fresh",
      }),
    );
  });
});

describe("assessAgent — reachability is never presented as safety", () => {
  const cases = [
    assessAgent({ now: NOW, agent: null, observations: [] }),
    assessAgent({ now: NOW, agent: agent(), observations: [] }),
    assessAgent({
      now: NOW,
      agent: agent(),
      observations: [ok(minutesAgo(1)), ok(minutesAgo(30))],
    }),
    assessAgent({
      now: NOW,
      agent: agent({ score: 99, verified: true }),
      observations: [ok(minutesAgo(1))],
    }),
    assessAgent({
      now: NOW,
      agent: agent(),
      observations: [fail(minutesAgo(1))],
    }),
  ];

  it("every result starts its limitations with the reachability-is-not-safety statement", () => {
    for (const a of cases)
      expect(a.limitations[0]).toBe(REACHABILITY_IS_NOT_SAFETY);
  });

  it("never emits a decision outside the three allowed values", () => {
    for (const a of cases) {
      expect([
        "allow_with_caution",
        "avoid",
        "insufficient_evidence",
      ]).toContain(a.decision);
    }
  });

  it("is always cached and complete in this phase, and says so when evidence was used", () => {
    for (const a of cases)
      expect(a).toMatchObject({ mode: "cached", status: "complete" });
    expect(cases[2].limitations).toContain(CACHED_EVIDENCE_LIMITATION);
  });
});

describe("assessAgent — context and freshness", () => {
  it("flags unverified, externally observed and recently registered agents", () => {
    const a = assessAgent({
      now: NOW,
      agent: agent({
        source: "externally_observed",
        registeredAt: hoursAgo(3),
      }),
      observations: [ok(minutesAgo(1)), ok(minutesAgo(20))],
    });
    expect(a.reasonCodes).toEqual(
      expect.arrayContaining([
        "OWNERSHIP_UNVERIFIED",
        "EXTERNALLY_OBSERVED",
        "RECENTLY_REGISTERED",
      ]),
    );
  });

  it("marks reachability fresh only within 15 minutes, and reports evidence age and expiry", () => {
    const freshResult = assessAgent({
      now: NOW,
      agent: agent(),
      observations: [ok(minutesAgo(14))],
    });
    expect(freshResult.reachability).toMatchObject({
      fresh: true,
      ageSeconds: 840,
      source: "scheduled_check",
    });
    expect(freshResult.reasonCodes).not.toContain("NO_RECENT_LIVE_CHECK");

    const old = assessAgent({
      now: NOW,
      agent: agent(),
      observations: [ok(hoursAgo(20))],
    });
    expect(old.reachability.fresh).toBe(false);
    expect(old.reasonCodes).toContain("NO_RECENT_LIVE_CHECK");
    expect(old.freshness).toEqual({
      assessedAt: NOW.toISOString(),
      evidenceAgeSeconds: 20 * 3600,
      evidenceExpiresAt: new Date(
        hoursAgo(20).getTime() + 50 * 3600 * 1000,
      ).toISOString(),
    });
  });
});
