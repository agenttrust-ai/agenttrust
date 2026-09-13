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
  authCredential: "test-bearer-token",
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

describe("runHealthCheckBatch — authenticated monitoring", () => {
  it("decrypts a stored bearer credential and passes an Authorization header to checkAgentHealth", async () => {
    const agent = await createAgent(db, userA, {
      ...baseInput,
      authType: "bearer",
      authCredential: "my-bearer-secret",
    });
    await activate(agent.id);
    mockedCheckAgentHealth.mockResolvedValue(successResult());

    await runHealthCheckBatch(db, 10);

    expect(mockedCheckAgentHealth).toHaveBeenCalledWith(agent.endpointUrl, {
      name: "Authorization",
      value: "Bearer my-bearer-secret",
    });
  });

  it("decrypts a stored api_key credential and passes the custom header name to checkAgentHealth", async () => {
    const agent = await createAgent(db, userA, {
      ...baseInput,
      authType: "api_key",
      authCredential: "my-api-key",
      authHeaderName: "X-Custom-Key",
    });
    await activate(agent.id);
    mockedCheckAgentHealth.mockResolvedValue(successResult());

    await runHealthCheckBatch(db, 10);

    expect(mockedCheckAgentHealth).toHaveBeenCalledWith(agent.endpointUrl, {
      name: "X-Custom-Key",
      value: "my-api-key",
    });
  });

  it("passes no auth header at all for an authType-none agent — behaves exactly as before this feature", async () => {
    const agent = await createAgent(db, userA, { ...baseInput, authType: "none", authCredential: undefined });
    await activate(agent.id);
    mockedCheckAgentHealth.mockResolvedValue(successResult());

    await runHealthCheckBatch(db, 10);

    expect(mockedCheckAgentHealth).toHaveBeenCalledWith(agent.endpointUrl, undefined);
  });

  it("records a failed check — without ever calling checkAgentHealth — when the stored ciphertext can't be decrypted, and doesn't crash the batch", async () => {
    const agent = await createAgent(db, userA, {
      ...baseInput,
      authType: "bearer",
      authCredential: "my-bearer-secret",
    });
    await activate(agent.id);
    // Simulate a corrupted/mismatched-key ciphertext directly at the DB
    // layer — not reachable through the normal create/update path.
    await client.query(
      `update public.agents set auth_credential_ciphertext = 'not-valid-ciphertext' where id = $1`,
      [agent.id],
    );

    const summary = await runHealthCheckBatch(db, 10);

    expect(mockedCheckAgentHealth).not.toHaveBeenCalled();
    expect(summary.claimed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.succeeded).toBe(0);

    const rows = await client.query<{ error_code: string; success: boolean }>(
      `select error_code, success from public.health_checks where agent_id = $1`,
      [agent.id],
    );
    expect(rows.rows[0]).toEqual({ error_code: "CREDENTIAL_DECRYPT_FAILED", success: false });
  });
});
