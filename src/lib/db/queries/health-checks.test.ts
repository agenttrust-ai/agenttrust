import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, seedUser } from "@/lib/db/test-harness";
import type { AppDatabase } from "@/lib/db/rls";
import { activateOwnedAgent, createAgent } from "./agents";
import {
  claimDueAgents,
  getLatestChecksForAgents,
  getRecentChecksForStatus,
  listRecentChecksForOwnedAgent,
  recordHealthCheck,
  setAgentStatus,
} from "./health-checks";
import type { AgentInput } from "@/lib/validation/agent";
import type { HealthCheckResult } from "@/lib/monitoring/health-check";

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

const successResult: HealthCheckResult = {
  status: "success",
  success: true,
  httpStatus: 200,
  latencyMs: 42,
  errorCode: null,
  errorMessage: null,
  attempts: 1,
};

let client: PGlite;
let db: AppDatabase;

async function activateAgent(agentId: string, nextCheckAt: Date | null = null) {
  await client.query(
    `update public.agents set lifecycle_status = 'active', next_check_at = $2 where id = $1`,
    [agentId, nextCheckAt],
  );
}

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

describe("claimDueAgents", () => {
  it("a freshly-registered (draft) agent is not claimed until its owner activates it via activateOwnedAgent", async () => {
    const agent = await createAgent(db, userA, baseInput);

    const beforeActivation = await claimDueAgents(db, 10);
    expect(beforeActivation.map((a) => a.id)).not.toContain(agent.id);

    await activateOwnedAgent(db, userA, agent.id);

    const afterActivation = await claimDueAgents(db, 10);
    expect(afterActivation.map((a) => a.id)).toContain(agent.id);
  });

  it("claims an active agent that has never been checked (next_check_at is null)", async () => {
    const agent = await createAgent(db, userA, baseInput);
    await activateAgent(agent.id);

    const claimed = await claimDueAgents(db, 10);
    expect(claimed.map((a) => a.id)).toContain(agent.id);
  });

  it("claims an active agent whose next_check_at is in the past", async () => {
    const agent = await createAgent(db, userA, baseInput);
    await activateAgent(agent.id, new Date(Date.now() - 60_000));

    const claimed = await claimDueAgents(db, 10);
    expect(claimed.map((a) => a.id)).toContain(agent.id);
  });

  it("does not claim an agent whose next_check_at is in the future", async () => {
    const agent = await createAgent(db, userA, baseInput);
    await activateAgent(agent.id, new Date(Date.now() + 60_000));

    const claimed = await claimDueAgents(db, 10);
    expect(claimed.map((a) => a.id)).not.toContain(agent.id);
  });

  it("does not claim a draft (not yet active) agent", async () => {
    const agent = await createAgent(db, userA, baseInput);
    // left as 'draft' — never activated

    const claimed = await claimDueAgents(db, 10);
    expect(claimed.map((a) => a.id)).not.toContain(agent.id);
  });

  it("does not claim a deactivated agent", async () => {
    const agent = await createAgent(db, userA, baseInput);
    await activateAgent(agent.id);
    await client.query(
      `update public.agents set lifecycle_status = 'deactivated' where id = $1`,
      [agent.id],
    );

    const claimed = await claimDueAgents(db, 10);
    expect(claimed.map((a) => a.id)).not.toContain(agent.id);
  });

  it("respects the batch limit", async () => {
    for (let i = 0; i < 5; i++) {
      const agent = await createAgent(db, userA, {
        ...baseInput,
        name: `Bot ${i}`,
      });
      await activateAgent(agent.id);
    }
    const claimed = await claimDueAgents(db, 3);
    expect(claimed).toHaveLength(3);
  });

  it("is safe against duplicate scheduled execution: a claimed agent is not reclaimed before its next interval", async () => {
    const agent = await createAgent(db, userA, baseInput);
    await activateAgent(agent.id);

    const firstRun = await claimDueAgents(db, 10);
    expect(firstRun.map((a) => a.id)).toContain(agent.id);

    // A second cron invocation firing immediately after — simulating a
    // duplicate/overlapping trigger — must not pick the same agent back up,
    // because claiming already pushed next_check_at into the future.
    const secondRun = await claimDueAgents(db, 10);
    expect(secondRun.map((a) => a.id)).not.toContain(agent.id);
  });

  it("holds a row lock so a genuinely concurrent claim cannot double-claim the same agent", async () => {
    const agent = await createAgent(db, userA, baseInput);
    await activateAgent(agent.id);

    const [first, second] = await Promise.all([
      claimDueAgents(db, 10),
      claimDueAgents(db, 10),
    ]);

    const claimedBy = [...first, ...second].filter((a) => a.id === agent.id);
    expect(claimedBy).toHaveLength(1);
  });

  it("never claims a push-mode agent, even when it's due and active", async () => {
    const agent = await createAgent(db, userA, baseInput);
    await activateAgent(agent.id);
    await client.query(
      `update public.agents set monitoring_mode = 'push' where id = $1`,
      [agent.id],
    );

    const claimed = await claimDueAgents(db, 10);
    expect(claimed.map((a) => a.id)).not.toContain(agent.id);
  });

  it("still claims a pull-mode agent alongside a push-mode one, picking only the pull agent", async () => {
    const pullAgent = await createAgent(db, userA, { ...baseInput, name: "Pull Bot" });
    await activateAgent(pullAgent.id);

    const pushAgent = await createAgent(db, userA, { ...baseInput, name: "Push Bot" });
    await activateAgent(pushAgent.id);
    await client.query(
      `update public.agents set monitoring_mode = 'push' where id = $1`,
      [pushAgent.id],
    );

    const claimed = await claimDueAgents(db, 10);
    expect(claimed.map((a) => a.id)).toContain(pullAgent.id);
    expect(claimed.map((a) => a.id)).not.toContain(pushAgent.id);
  });
});

describe("recordHealthCheck + getRecentChecksForStatus", () => {
  it("persists a check and returns it newest-first", async () => {
    const agent = await createAgent(db, userA, baseInput);
    await activateAgent(agent.id);

    await recordHealthCheck(db, agent.id, successResult);
    await recordHealthCheck(db, agent.id, {
      ...successResult,
      success: false,
      status: "http_error",
      httpStatus: 500,
      errorCode: "HTTP_500",
    });

    const recent = await getRecentChecksForStatus(db, agent.id, 10);
    expect(recent).toHaveLength(2);
    expect(recent[0].success).toBe(false); // most recent inserted last, listed first
  });

  it("defaults to method 'pull' when none is given", async () => {
    const agent = await createAgent(db, userA, baseInput);
    await activateAgent(agent.id);
    await recordHealthCheck(db, agent.id, successResult);

    const rows = await client.query<{ method: string }>(
      `select method from public.health_checks where agent_id = $1`,
      [agent.id],
    );
    expect(rows.rows[0].method).toBe("pull");
  });

  it("records a push heartbeat with a null latency and method 'push'", async () => {
    const agent = await createAgent(db, userA, baseInput);
    await activateAgent(agent.id);
    await recordHealthCheck(
      db,
      agent.id,
      {
        status: "success",
        success: true,
        latencyMs: null,
        httpStatus: null,
        errorCode: null,
        errorMessage: null,
      },
      "push",
    );

    const rows = await client.query<{ method: string; latency_ms: number | null }>(
      `select method, latency_ms from public.health_checks where agent_id = $1`,
      [agent.id],
    );
    expect(rows.rows[0]).toEqual({ method: "push", latency_ms: null });
  });
});

describe("setAgentStatus", () => {
  it("updates the agent's cached status", async () => {
    const agent = await createAgent(db, userA, baseInput);
    await activateAgent(agent.id);
    await setAgentStatus(db, agent.id, "healthy");

    const rows = await client.query(
      `select current_status from public.agents where id = $1`,
      [agent.id],
    );
    expect(rows.rows[0]).toEqual({ current_status: "healthy" });
  });
});

describe("listRecentChecksForOwnedAgent — authorization + RLS", () => {
  it("lets the owner read their agent's health history", async () => {
    const agent = await createAgent(db, userA, baseInput);
    await activateAgent(agent.id);
    await recordHealthCheck(db, agent.id, successResult);

    const history = await listRecentChecksForOwnedAgent(db, userA, agent.id);
    expect(history).toHaveLength(1);
  });

  it("hides another user's agent's health history as NOT_FOUND", async () => {
    const agent = await createAgent(db, userA, baseInput);
    await activateAgent(agent.id);
    await recordHealthCheck(db, agent.id, successResult);

    await expect(
      listRecentChecksForOwnedAgent(db, userB, agent.id),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("getLatestChecksForAgents — RLS-sensitive access", () => {
  it("returns only the most recent check per agent, for the owner's own agents", async () => {
    const agentA = await createAgent(db, userA, baseInput);
    await activateAgent(agentA.id);
    await recordHealthCheck(db, agentA.id, { ...successResult, latencyMs: 10 });
    await recordHealthCheck(db, agentA.id, { ...successResult, latencyMs: 99 });

    const latest = await getLatestChecksForAgents(db, userA, [agentA.id]);
    expect(latest.size).toBe(1);
    expect(latest.get(agentA.id)?.latencyMs).toBe(99);
  });

  it("silently omits another owner's still-private (draft) agent, rather than leaking its data", async () => {
    // Left in the default 'draft' lifecycle — not activated, so RLS's
    // public-read policy doesn't apply and only the real owner can see it.
    const agentB = await createAgent(db, userB, baseInput);
    await recordHealthCheck(db, agentB.id, successResult);

    const latest = await getLatestChecksForAgents(db, userA, [agentB.id]);
    expect(latest.size).toBe(0);
  });

  it("does return another owner's public+active agent — that visibility is intentional (powers the public profile page)", async () => {
    const agentB = await createAgent(db, userB, baseInput);
    await activateAgent(agentB.id); // default visibility is 'public'
    await recordHealthCheck(db, agentB.id, successResult);

    const latest = await getLatestChecksForAgents(db, userA, [agentB.id]);
    expect(latest.size).toBe(1);
  });
});
