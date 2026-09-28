import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, seedUser } from "@/lib/db/test-harness";
import type { AppDatabase } from "@/lib/db/rls";
import { createAgent } from "./agents";
import { recordHealthCheck } from "./health-checks";
import {
  computeAndStoreReliabilityScore,
  getLatestReliabilityScoreForOwnedAgent,
  getLatestReliabilityScorePublic,
  getLatestReliabilityScoresForAgents,
  getReliabilityScoreStatePublic,
  getReliabilityScoreStatusesForOwnedAgents,
} from "./reliability";
import { MIN_SAMPLES_FOR_SCORE, FORMULA_VERSION } from "@/lib/reliability/scoring";
import type { AgentInput } from "@/lib/validation/agent";
import { ErrorCode } from "@/lib/errors";

const userA = "11111111-1111-1111-1111-111111111111";
const userB = "22222222-2222-2222-2222-222222222222";

const baseInput: AgentInput = {
  name: "Support Bot",
  description: "Handles tier-1 support.",
  endpointUrl: "https://agent.acme.io/v1/invoke",
  version: "1.0.0",
  capabilities: ["chat"],
  authType: "bearer",
  authCredential: "test-bearer-token",
};

let client: PGlite;
let db: AppDatabase;

beforeEach(async () => {
  const harness = await createTestDb();
  client = harness.client;
  db = harness.db;
  await seedUser(client, userA, "a@example.com");
  await seedUser(client, userB, "b@example.com");
});

afterEach(async () => {
  await client.close();
});

async function activate(agentId: string, visibility: "public" | "unlisted" = "public") {
  await client.query(
    `update public.agents set lifecycle_status = 'active', visibility = $2 where id = $1`,
    [agentId, visibility],
  );
}

async function recordChecks(
  agentId: string,
  count: number,
  build: (i: number) => { success: boolean; latencyMs: number | null },
  method: "pull" | "push" = "pull",
) {
  for (let i = 0; i < count; i++) {
    const { success, latencyMs } = build(i);
    await recordHealthCheck(
      db,
      agentId,
      {
        status: success ? "success" : "http_error",
        success,
        latencyMs,
        httpStatus: success ? 200 : 500,
        errorCode: success ? null : "HTTP_500",
        errorMessage: null,
      },
      method,
    );
  }
}

describe("computeAndStoreReliabilityScore", () => {
  it("returns null and stores nothing when there's not enough history", async () => {
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);
    await recordChecks(agent.id, MIN_SAMPLES_FOR_SCORE - 1, () => ({
      success: true,
      latencyMs: 100,
    }));

    const result = await computeAndStoreReliabilityScore(db, agent.id, new Date());
    expect(result).toBeNull();

    const rows = await client.query(`select count(*)::int as n from public.reliability_scores`);
    expect(rows.rows[0]).toEqual({ n: 0 });
  });

  it("computes and stores a snapshot once there's enough history", async () => {
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);
    await recordChecks(agent.id, MIN_SAMPLES_FOR_SCORE, () => ({
      success: true,
      latencyMs: 100,
    }));

    const now = new Date();
    const result = await computeAndStoreReliabilityScore(db, agent.id, now);
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThan(0);

    const rows = await client.query<{
      score: string;
      formula_version: string;
      window_end: string;
    }>(`select score, formula_version, window_end from public.reliability_scores where agent_id = $1`, [
      agent.id,
    ]);
    expect(rows.rows).toHaveLength(1);
    expect(Number(rows.rows[0].score)).toBe(result!.score);
    expect(rows.rows[0].formula_version).toBe(FORMULA_VERSION);
    expect(new Date(rows.rows[0].window_end).getTime()).toBe(now.getTime());
  });

  it("only counts checks inside the trailing window, ignoring checks from before it", async () => {
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);

    // A batch of old failing checks, backdated well outside the score window.
    await recordChecks(agent.id, MIN_SAMPLES_FOR_SCORE, () => ({
      success: false,
      latencyMs: null,
    }));
    await client.query(
      `update public.health_checks set checked_at = now() - interval '30 days' where agent_id = $1`,
      [agent.id],
    );

    // A fresh batch of healthy checks, inside the window.
    await recordChecks(agent.id, MIN_SAMPLES_FOR_SCORE, () => ({
      success: true,
      latencyMs: 100,
    }));

    const result = await computeAndStoreReliabilityScore(db, agent.id, new Date());
    expect(result).not.toBeNull();
    expect(result!.uptimeSubscore).toBe(100); // the old failures are outside the window
    expect(result!.sampleSize).toBe(MIN_SAMPLES_FOR_SCORE);
  });

  it("scores a pull-mode agent's history the same way regardless of method, and a push-mode agent's heartbeat history too", async () => {
    const pullAgent = await createAgent(db, userA, { ...baseInput, name: "Pull Bot" });
    await activate(pullAgent.id);
    await recordChecks(
      pullAgent.id,
      MIN_SAMPLES_FOR_SCORE,
      () => ({ success: true, latencyMs: 120 }),
      "pull",
    );

    const pushAgent = await createAgent(db, userA, { ...baseInput, name: "Push Bot" });
    await activate(pushAgent.id);
    await recordChecks(
      pushAgent.id,
      MIN_SAMPLES_FOR_SCORE,
      () => ({ success: true, latencyMs: null }),
      "push",
    );

    const pullResult = await computeAndStoreReliabilityScore(db, pullAgent.id, new Date());
    const pushResult = await computeAndStoreReliabilityScore(db, pushAgent.id, new Date());

    expect(pullResult).not.toBeNull();
    expect(pushResult).not.toBeNull();
    expect(pushResult!.uptimeSubscore).toBe(pullResult!.uptimeSubscore);
    expect(pushResult!.score).toBe(pullResult!.score); // both perfectly healthy, latency neutral either way
  });

  it("stores a low score for a fully down window, not an unjustified high one", async () => {
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);
    await recordChecks(agent.id, 30, () => ({ success: false, latencyMs: null }));

    const result = await computeAndStoreReliabilityScore(db, agent.id, new Date());
    expect(result).not.toBeNull();
    expect(result!.score).toBeLessThan(30);
  });
});

describe("getLatestReliabilityScoreForOwnedAgent — authorization", () => {
  it("returns null (not an error) when no score has been computed yet", async () => {
    const agent = await createAgent(db, userA, baseInput);
    const score = await getLatestReliabilityScoreForOwnedAgent(db, userA, agent.id);
    expect(score).toBeNull();
  });

  it("returns the most recent snapshot for the owner", async () => {
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);
    await recordChecks(agent.id, MIN_SAMPLES_FOR_SCORE, () => ({
      success: true,
      latencyMs: 100,
    }));
    await computeAndStoreReliabilityScore(db, agent.id, new Date());

    const score = await getLatestReliabilityScoreForOwnedAgent(db, userA, agent.id);
    expect(score).not.toBeNull();
    expect(score!.score).toBeGreaterThan(0);
  });

  it("hides another owner's agent's score as NOT_FOUND", async () => {
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);
    await recordChecks(agent.id, MIN_SAMPLES_FOR_SCORE, () => ({
      success: true,
      latencyMs: 100,
    }));
    await computeAndStoreReliabilityScore(db, agent.id, new Date());

    await expect(
      getLatestReliabilityScoreForOwnedAgent(db, userB, agent.id),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });
});

describe("getLatestReliabilityScorePublic — visibility", () => {
  it("is visible for a public+active agent", async () => {
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);
    await recordChecks(agent.id, MIN_SAMPLES_FOR_SCORE, () => ({
      success: true,
      latencyMs: 100,
    }));
    await computeAndStoreReliabilityScore(db, agent.id, new Date());

    const score = await getLatestReliabilityScorePublic(db, agent.id);
    expect(score).not.toBeNull();
  });

  it("is null for a draft agent that has never been scored, without erroring", async () => {
    const agent = await createAgent(db, userA, baseInput);
    const score = await getLatestReliabilityScorePublic(db, agent.id);
    expect(score).toBeNull();
  });
});

describe("getLatestReliabilityScoresForAgents — batched owner view", () => {
  it("returns one score per agent, keyed by agent id", async () => {
    const agentA = await createAgent(db, userA, { ...baseInput, name: "A" });
    await activate(agentA.id);
    await recordChecks(agentA.id, MIN_SAMPLES_FOR_SCORE, () => ({
      success: true,
      latencyMs: 100,
    }));
    await computeAndStoreReliabilityScore(db, agentA.id, new Date());

    const agentB = await createAgent(db, userA, { ...baseInput, name: "B" });
    // agentB never scored — not enough history.

    const scores = await getLatestReliabilityScoresForAgents(db, userA, [
      agentA.id,
      agentB.id,
    ]);
    expect(scores.size).toBe(1);
    expect(scores.has(agentA.id)).toBe(true);
    expect(scores.has(agentB.id)).toBe(false);
  });

  it("returns an empty map for an empty agent id list", async () => {
    const scores = await getLatestReliabilityScoresForAgents(db, userA, []);
    expect(scores.size).toBe(0);
  });
});

describe("reliability score freshness (none / fresh / stale)", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const HOUR = 60 * 60 * 1000;

  async function checkAt(agentId: string, when: Date) {
    await recordHealthCheck(
      db,
      agentId,
      {
        status: "success",
        success: true,
        latencyMs: 120,
        httpStatus: 200,
        errorCode: null,
        errorMessage: null,
      },
      "pull",
      when,
    );
  }

  async function publicAgent(name: string) {
    const agent = await createAgent(db, userA, {
      ...baseInput,
      name,
      endpointUrl: `https://${name.toLowerCase().replace(/\s+/g, "-")}.example.com/invoke`,
    });
    await activate(agent.id);
    return agent;
  }

  async function scoreRows(agentId: string) {
    const rows = await client.query<{ score: string; window_end: Date }>(
      `select score, window_end from public.reliability_scores where agent_id = $1 order by computed_at`,
      [agentId],
    );
    return rows.rows;
  }

  it("is 'none' for an agent with no score", async () => {
    const agent = await publicAgent("No Score Bot");
    const state = await getReliabilityScoreStatePublic(db, agent.id);
    expect(state).toEqual({ score: null, status: "none" });
  });

  it("is 'fresh' with exactly 5 checks in the trailing window", async () => {
    const now = new Date();
    const agent = await publicAgent("Fresh Five Bot");
    for (let i = 1; i <= MIN_SAMPLES_FOR_SCORE; i++) await checkAt(agent.id, new Date(now.getTime() - i * HOUR));
    await computeAndStoreReliabilityScore(db, agent.id, now);

    const state = await getReliabilityScoreStatePublic(db, agent.id, now);
    expect(state.status).toBe("fresh");
    expect(state.score).not.toBeNull();
  });

  /** Records a check at `when` and scores it, exactly as one monitoring run does for one agent. */
  async function runAt(agentId: string, when: Date) {
    await checkAt(agentId, when);
    return computeAndStoreReliabilityScore(db, agentId, when);
  }

  async function checksInTrailingWeek(agentId: string, at: Date) {
    const rows = await client.query<{ n: number }>(
      `select count(*)::int as n from public.health_checks
        where agent_id = $1 and checked_at >= $2 and checked_at <= $3`,
      [agentId, new Date(at.getTime() - 7 * DAY), at],
    );
    return rows.rows[0].n;
  }

  // Regression: the 2026-09-27 production case. Agents with exactly five
  // daily checks were scored at 00:44:10, and went stale ~1.5s later when
  // the 09-20 check (taken at 00:44:11.5) aged out of a 7-day window
  // re-counted at read time — with no new evidence either way.
  it("keeps the 2026-09-27 boundary scores fresh until the next run, though the oldest sample aged out seconds later", async () => {
    const agent = await publicAgent("Boundary Regression Bot");
    for (const at of [
      "2026-09-20T00:44:11.500Z",
      "2026-09-23T00:44:11.420Z",
      "2026-09-25T00:44:12.637Z",
      "2026-09-26T00:44:12.664Z",
    ]) {
      await checkAt(agent.id, new Date(at));
    }
    const run = new Date("2026-09-27T00:44:10.012Z");
    expect(await runAt(agent.id, run)).not.toBeNull();

    const audit = new Date("2026-09-27T12:46:48.710Z");
    // The condition that used to flip it: only 4 of its 5 samples are
    // still inside a 7-day window ending at the audit.
    expect(await checksInTrailingWeek(agent.id, audit)).toBe(4);

    for (const at of [run, new Date(run.getTime() + 2000), audit, new Date(run.getTime() + DAY - 60_000)]) {
      expect((await getReliabilityScoreStatePublic(db, agent.id, at)).status).toBe("fresh");
    }
  });

  it("is fresh 23h59m after computation, though the oldest sample has left the original window", async () => {
    const run = new Date();
    const agent = await publicAgent("Aging Sample Bot");
    await checkAt(agent.id, new Date(run.getTime() - 7 * DAY + 60_000));
    for (let i = 1; i <= 3; i++) await checkAt(agent.id, new Date(run.getTime() - i * DAY));
    expect(await runAt(agent.id, run)).not.toBeNull();

    const later = new Date(run.getTime() + DAY - 60_000);
    expect(await checksInTrailingWeek(agent.id, later)).toBe(4);
    expect((await getReliabilityScoreStatePublic(db, agent.id, later)).status).toBe("fresh");
  });

  it("goes stale once a newer check is 10 minutes old without having produced a score", async () => {
    const t = new Date();
    const agent = await publicAgent("Insufficient Rerun Bot");
    // Five samples at T; two days later only three remain in the window.
    await checkAt(agent.id, new Date(t.getTime() - 7 * DAY + HOUR));
    await checkAt(agent.id, new Date(t.getTime() - 6 * DAY));
    await checkAt(agent.id, new Date(t.getTime() - 5 * DAY - HOUR));
    await checkAt(agent.id, new Date(t.getTime() - 4 * DAY));
    expect(await runAt(agent.id, t)).not.toBeNull();

    const rerun = new Date(t.getTime() + 2 * DAY);
    expect(await runAt(agent.id, rerun)).toBeNull();
    expect(await scoreRows(agent.id)).toHaveLength(1);

    // Within the settle window the previous score still stands…
    expect((await getReliabilityScoreStatePublic(db, agent.id, new Date(rerun.getTime() + 5 * 60_000))).status).toBe(
      "fresh",
    );
    // …then the observation that couldn't be scored makes it stale.
    for (const after of [10 * 60_000, 12 * HOUR]) {
      const state = await getReliabilityScoreStatePublic(db, agent.id, new Date(rerun.getTime() + after));
      expect(state.status).toBe("stale");
      expect(state.score).not.toBeNull();
    }
  });

  it("doesn't flicker stale in the moment between a check and its own score being written", async () => {
    const t = new Date();
    const agent = await publicAgent("Mid Write Bot");
    for (let i = 1; i <= MIN_SAMPLES_FOR_SCORE; i++) await checkAt(agent.id, new Date(t.getTime() - i * DAY + HOUR));
    expect(await runAt(agent.id, t)).not.toBeNull();

    const next = new Date(t.getTime() + DAY);
    await checkAt(agent.id, next); // written; its score isn't yet
    expect((await getReliabilityScoreStatePublic(db, agent.id, new Date(next.getTime() + 500))).status).toBe("fresh");
    await computeAndStoreReliabilityScore(db, agent.id, next);
    expect((await getReliabilityScoreStatePublic(db, agent.id, new Date(next.getTime() + HOUR))).status).toBe("fresh");
  });

  it("stays fresh while each monitoring run keeps rescoring", async () => {
    const start = new Date(Date.now() - 6 * DAY);
    const agent = await publicAgent("Daily Bot");
    for (let d = 0; d <= 6; d++) await runAt(agent.id, new Date(start.getTime() + d * DAY));

    const last = new Date(start.getTime() + 6 * DAY);
    expect((await getReliabilityScoreStatePublic(db, agent.id, new Date(last.getTime() + 20 * HOUR))).status).toBe(
      "fresh",
    );
  });

  it("goes stale after 50 hours without a new score — monitoring stopped", async () => {
    const t = new Date(Date.now() - 3 * DAY);
    const agent = await publicAgent("Silent Bot");
    for (let i = 1; i <= MIN_SAMPLES_FOR_SCORE; i++) await checkAt(agent.id, new Date(t.getTime() - i * HOUR));
    expect(await runAt(agent.id, t)).not.toBeNull();

    expect((await getReliabilityScoreStatePublic(db, agent.id, new Date(t.getTime() + 50 * HOUR))).status).toBe(
      "fresh",
    );
    expect((await getReliabilityScoreStatePublic(db, agent.id, new Date(t.getTime() + 50 * HOUR + 1))).status).toBe(
      "stale",
    );
  });

  it("stays stale for a score whose window_end is over a week old, even with enough new checks since", async () => {
    const now = new Date();
    const agent = await publicAgent("Old Window Bot");
    for (let i = 0; i < MIN_SAMPLES_FOR_SCORE; i++) await checkAt(agent.id, new Date(now.getTime() - 8 * DAY - i * HOUR));
    await computeAndStoreReliabilityScore(db, agent.id, new Date(now.getTime() - 8 * DAY));
    for (let i = 1; i <= MIN_SAMPLES_FOR_SCORE; i++) await checkAt(agent.id, new Date(now.getTime() - i * HOUR));

    expect((await getReliabilityScoreStatePublic(db, agent.id, now)).status).toBe("stale");
  });

  it("returns the historical score unchanged when stale — never deleted or rewritten", async () => {
    const now = new Date();
    const agent = await publicAgent("Historical Bot");
    for (let i = 0; i < MIN_SAMPLES_FOR_SCORE; i++) await checkAt(agent.id, new Date(now.getTime() - 9 * DAY - i * HOUR));
    await computeAndStoreReliabilityScore(db, agent.id, new Date(now.getTime() - 9 * DAY));
    const before = await scoreRows(agent.id);
    expect(before).toHaveLength(1);

    const state = await getReliabilityScoreStatePublic(db, agent.id, now);

    expect(state.status).toBe("stale");
    expect(state.score?.score).toBe(Number(before[0].score));
    expect(await scoreRows(agent.id)).toEqual(before);
  });

  it("classifies every owned agent in one call, including ones with no score", async () => {
    const now = new Date();
    const fresh = await publicAgent("Owner Fresh Bot");
    for (let i = 1; i <= MIN_SAMPLES_FOR_SCORE; i++) await checkAt(fresh.id, new Date(now.getTime() - i * HOUR));
    await computeAndStoreReliabilityScore(db, fresh.id, now);
    const stale = await publicAgent("Owner Stale Bot");
    for (let i = 0; i < MIN_SAMPLES_FOR_SCORE; i++) await checkAt(stale.id, new Date(now.getTime() - 9 * DAY - i * HOUR));
    await computeAndStoreReliabilityScore(db, stale.id, new Date(now.getTime() - 9 * DAY));
    const none = await publicAgent("Owner None Bot");

    const latest = await getLatestReliabilityScoresForAgents(db, userA, [fresh.id, stale.id, none.id]);
    const statuses = await getReliabilityScoreStatusesForOwnedAgents(
      db,
      userA,
      new Map([fresh.id, stale.id, none.id].map((id) => [id, latest.get(id) ?? null])),
      now,
    );

    expect(statuses.get(fresh.id)).toBe("fresh");
    expect(statuses.get(stale.id)).toBe("stale");
    expect(statuses.get(none.id)).toBe("none");
  });

  it("gives the public and owner paths the same classification in every case", async () => {
    const t = new Date();
    const cases: { name: string; setup: (id: string) => Promise<void>; expected: string }[] = [
      { name: "Agree None Bot", setup: async () => {}, expected: "none" },
      {
        name: "Agree Fresh Bot",
        setup: async (id) => {
          for (let i = 1; i <= MIN_SAMPLES_FOR_SCORE; i++) await checkAt(id, new Date(t.getTime() - i * HOUR));
          await runAt(id, t);
        },
        expected: "fresh",
      },
      {
        name: "Agree Unscored Rerun Bot",
        setup: async (id) => {
          const scoredAt = new Date(t.getTime() - 2 * DAY);
          for (let i = 1; i <= MIN_SAMPLES_FOR_SCORE; i++) await checkAt(id, new Date(scoredAt.getTime() - 7 * DAY + i * HOUR));
          await runAt(id, scoredAt);
          await runAt(id, new Date(t.getTime() - HOUR));
        },
        expected: "stale",
      },
      {
        name: "Agree Old Bot",
        setup: async (id) => {
          const scoredAt = new Date(t.getTime() - 4 * DAY);
          for (let i = 1; i <= MIN_SAMPLES_FOR_SCORE; i++) await checkAt(id, new Date(scoredAt.getTime() - i * HOUR));
          await runAt(id, scoredAt);
        },
        expected: "stale",
      },
    ];

    const ids: string[] = [];
    for (const c of cases) {
      const agent = await publicAgent(c.name);
      await c.setup(agent.id);
      ids.push(agent.id);
    }

    const latest = await getLatestReliabilityScoresForAgents(db, userA, ids);
    const owner = await getReliabilityScoreStatusesForOwnedAgents(
      db,
      userA,
      new Map(ids.map((id) => [id, latest.get(id) ?? null])),
      t,
    );
    for (const [i, c] of cases.entries()) {
      const pub = await getReliabilityScoreStatePublic(db, ids[i], t);
      expect(pub.status, c.name).toBe(c.expected);
      expect(owner.get(ids[i]), c.name).toBe(c.expected);
    }
  });
});
