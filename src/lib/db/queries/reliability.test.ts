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
