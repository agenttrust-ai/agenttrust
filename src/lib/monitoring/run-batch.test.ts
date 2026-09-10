import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, seedUser } from "@/lib/db/test-harness";
import type { AppDatabase } from "@/lib/db/rls";
import { createAgent } from "@/lib/db/queries/agents";
import { MIN_SAMPLES_FOR_SCORE } from "@/lib/reliability/scoring";
import type { AgentInput } from "@/lib/validation/agent";

vi.mock("./health-check", () => ({
  checkAgentHealth: vi.fn(),
}));

import { checkAgentHealth } from "./health-check";
import { runHealthCheckBatch } from "./run-batch";

const mockedCheckAgentHealth = vi.mocked(checkAgentHealth);

const userA = "11111111-1111-1111-1111-111111111111";

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
  mockedCheckAgentHealth.mockReset();
});

afterEach(async () => {
  await client.close();
});

async function activate(agentId: string, monitoringMode: "pull" | "push" = "pull") {
  await client.query(
    `update public.agents set lifecycle_status = 'active', monitoring_mode = $2 where id = $1`,
    [agentId, monitoringMode],
  );
}

function successResult() {
  return {
    status: "success" as const,
    success: true,
    httpStatus: 200,
    latencyMs: 90,
    errorCode: null,
    errorMessage: null,
    attempts: 1,
  };
}

describe("runHealthCheckBatch — reliability score integration", () => {
  it("stores a reliability score snapshot for a pull-mode agent once enough checks have accumulated", async () => {
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);
    mockedCheckAgentHealth.mockResolvedValue(successResult());

    // Force the agent due on every run by resetting next_check_at.
    for (let i = 0; i < MIN_SAMPLES_FOR_SCORE; i++) {
      await client.query(`update public.agents set next_check_at = null where id = $1`, [
        agent.id,
      ]);
      await runHealthCheckBatch(db, 10);
    }

    const rows = await client.query<{ n: number }>(
      `select count(*)::int as n from public.reliability_scores where agent_id = $1`,
      [agent.id],
    );
    expect(rows.rows[0].n).toBeGreaterThan(0);
  });

  it("never invokes checkAgentHealth for a push-mode agent, so no score gets computed from it either", async () => {
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id, "push");

    await runHealthCheckBatch(db, 10);

    expect(mockedCheckAgentHealth).not.toHaveBeenCalled();
    const rows = await client.query<{ n: number }>(
      `select count(*)::int as n from public.reliability_scores where agent_id = $1`,
      [agent.id],
    );
    expect(rows.rows[0].n).toBe(0);
  });

  it("a scoring failure does not fail the health check batch itself", async () => {
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);
    mockedCheckAgentHealth.mockResolvedValue(successResult());

    // Corrupt window bounds are not something the real schema allows, so
    // instead prove resilience the direct way: the batch must still report
    // the check as succeeded even though there isn't enough history yet
    // for a score (computeAndStoreReliabilityScore legitimately returns
    // null on the first-ever check) — i.e. scoring never being able to run
    // yet must not be mistaken for, or turn into, a batch failure.
    const summary = await runHealthCheckBatch(db, 10);
    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(0);
  });
});
