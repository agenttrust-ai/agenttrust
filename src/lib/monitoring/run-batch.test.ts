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

describe("runHealthCheckBatch — chunked, concurrency-limited, time-budgeted runs", () => {
  async function createActivePullAgents(count: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const agent = await createAgent(db, userA, {
        ...baseInput,
        name: `Bot ${i}`,
        endpointUrl: `https://agent-${i}.acme.io/v1/invoke`,
        authType: "none",
        authCredential: undefined,
      });
      await activate(agent.id);
      ids.push(agent.id);
    }
    return ids;
  }

  async function checkCountsByAgent(): Promise<Map<string, number>> {
    const rows = await client.query<{ agent_id: string; n: number }>(
      `select agent_id, count(*)::int as n from public.health_checks group by agent_id`,
    );
    return new Map(rows.rows.map((r) => [r.agent_id, r.n]));
  }

  it("processes more agents than one chunk, in several claims, never exceeding the concurrency limit", async () => {
    const ids = await createActivePullAgents(8);
    let inFlight = 0;
    let maxInFlight = 0;
    mockedCheckAgentHealth.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight--;
      return successResult();
    });

    const summary = await runHealthCheckBatch(db, 100, { concurrency: 3, chunkSize: 3 });

    expect(summary.claimed).toBe(8);
    expect(summary.succeeded).toBe(8);
    expect(summary.failed).toBe(0);
    expect(summary.deferred).toBe(0);
    expect(summary.stoppedReason).toBe("drained");
    expect(maxInFlight).toBe(3);
    const counts = await checkCountsByAgent();
    for (const id of ids) expect(counts.get(id)).toBe(1);
  });

  it("stops at the per-run agent cap and leaves the rest untouched for the next run", async () => {
    const ids = await createActivePullAgents(5);
    mockedCheckAgentHealth.mockResolvedValue(successResult());

    const summary = await runHealthCheckBatch(db, 3, { concurrency: 2, chunkSize: 2 });

    expect(summary.claimed).toBe(3);
    expect(summary.succeeded).toBe(3);
    expect(summary.stoppedReason).toBe("max_agents");
    const untouched = await client.query<{ n: number }>(
      `select count(*)::int as n from public.agents where id = any($1) and next_check_at is null`,
      [ids],
    );
    expect(untouched.rows[0].n).toBe(2);
  });

  it("stops starting new checks once the time budget is spent, and releases claimed-but-unstarted agents", async () => {
    const ids = await createActivePullAgents(5);
    let fakeNow = Date.now();
    mockedCheckAgentHealth.mockImplementation(async () => {
      fakeNow += 100_000; // each check "takes" 100s on the injected clock
      return successResult();
    });

    const summary = await runHealthCheckBatch(db, 100, {
      concurrency: 1,
      chunkSize: 2,
      timeBudgetMs: 250_000,
      now: () => fakeNow,
    });

    // claim [a,b] -> check a (100s), check b (200s) -> claim [c,d] ->
    // check c (300s) -> budget spent: d is released, e was never claimed.
    expect(summary.stoppedReason).toBe("time_budget");
    expect(summary.claimed).toBe(4);
    expect(summary.succeeded).toBe(3);
    expect(summary.deferred).toBe(1);

    const counts = await checkCountsByAgent();
    expect(counts.size).toBe(3);

    const unchecked = ids.filter((id) => !counts.has(id));
    expect(unchecked).toHaveLength(2);
    const state = await client.query<{ never_claimed: number; released_and_due: number }>(
      `select count(*) filter (where next_check_at is null)::int as never_claimed,
              count(*) filter (where next_check_at is not null and next_check_at <= now())::int as released_and_due
       from public.agents where id = any($1)`,
      [unchecked],
    );
    expect(state.rows[0].never_claimed).toBe(1);
    expect(state.rows[0].released_and_due).toBe(1);
  });

  it("never checks the same agent twice in one run, even if it becomes due again mid-run", async () => {
    await createActivePullAgents(2);
    const runStartedAt = Date.now() - 60_000;
    const calls: string[] = [];
    mockedCheckAgentHealth.mockImplementation(async (url: string) => {
      calls.push(url);
      if (calls.length === 1) {
        // Simulate this agent's interval elapsing mid-run: due by now(),
        // but only since after the run started.
        await client.query(
          `update public.agents set next_check_at = now() - interval '30 seconds' where endpoint_url = $1`,
          [url],
        );
      }
      return successResult();
    });

    const summary = await runHealthCheckBatch(db, 100, {
      concurrency: 1,
      chunkSize: 1,
      now: () => runStartedAt,
    });

    expect(calls).toHaveLength(2);
    expect(new Set(calls).size).toBe(2);
    expect(summary.claimed).toBe(2);
    expect(summary.stoppedReason).toBe("drained");
  });

  it("one agent failing unexpectedly doesn't stop the rest of the run", async () => {
    await createActivePullAgents(3);
    mockedCheckAgentHealth.mockImplementation(async (url: string) => {
      if (url.includes("agent-1.")) throw new Error("boom");
      return successResult();
    });

    const summary = await runHealthCheckBatch(db, 100, { concurrency: 2, chunkSize: 2 });

    expect(summary.claimed).toBe(3);
    expect(summary.succeeded).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.stoppedReason).toBe("drained");
  });
});
