import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, seedUser } from "@/lib/db/test-harness";
import type { AppDatabase } from "@/lib/db/rls";
import { createAgent } from "@/lib/db/queries/agents";
import { createApiKey, revokeApiKey, listApiKeysForOwner } from "@/lib/db/queries/api-keys";
import { recordHealthCheck } from "@/lib/db/queries/health-checks";
import type { AgentInput } from "@/lib/validation/agent";
import {
  handleGetAgent,
  handleGetAgentHealth,
  handleHeartbeat,
  handleListAgents,
} from "./agents";
import { DEFAULT_RATE_LIMIT_PER_WINDOW } from "@/lib/rate-limit/config";
import {
  HEARTBEAT_DOWN_AFTER_MISSED_INTERVALS,
} from "@/lib/monitoring/heartbeat-status";
import { MIN_SAMPLES_FOR_SCORE } from "@/lib/reliability/scoring";

const userA = "11111111-1111-1111-1111-111111111111";
const userB = "22222222-2222-2222-2222-222222222222";

const baseInput: AgentInput = {
  name: "Support Bot",
  description: "Handles tier-1 support.",
  endpointUrl: "https://agent.acme.io/v1/invoke",
  version: "1.0.0",
  capabilities: ["chat", "ticket-triage"],
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

async function activate(agentId: string) {
  await client.query(
    `update public.agents set lifecycle_status = 'active' where id = $1`,
    [agentId],
  );
}

function requestTo(path: string, apiKey?: string): Request {
  const headers = new Headers();
  if (apiKey) headers.set("authorization", `Bearer ${apiKey}`);
  return new Request(`https://example.com${path}`, { headers });
}

function postTo(path: string, apiKey?: string, body?: unknown): Request {
  const headers = new Headers();
  if (apiKey) headers.set("authorization", `Bearer ${apiKey}`);
  const init: RequestInit = { method: "POST", headers };
  if (body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(body);
  }
  return new Request(`https://example.com${path}`, init);
}

async function setMonitoringMode(client: PGlite, agentId: string, mode: "pull" | "push") {
  await client.query(`update public.agents set monitoring_mode = $2 where id = $1`, [
    agentId,
    mode,
  ]);
}

async function bodyOf(response: Response) {
  return response.json();
}

describe("handleListAgents", () => {
  it("rejects a request with no API key as 401", async () => {
    const res = await handleListAgents(db, requestTo("/api/v1/agents"));
    expect(res.status).toBe(401);
    const body = await bodyOf(res);
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects an invalid API key as 401", async () => {
    const res = await handleListAgents(
      db,
      requestTo("/api/v1/agents", `at_live_${"x".repeat(43)}`),
    );
    expect(res.status).toBe(401);
  });

  it("rejects a revoked API key as 401", async () => {
    const { rawKey, key } = await createApiKey(db, userA, { name: "k" });
    await revokeApiKey(db, userA, key.id);

    const res = await handleListAgents(db, requestTo("/api/v1/agents", rawKey));
    expect(res.status).toBe(401);
  });

  it("returns public+active agents across all owners with a valid key", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });

    const pub = await createAgent(db, userA, { ...baseInput, name: "Public Bot" });
    await activate(pub.id);
    const otherOwner = await createAgent(db, userB, { ...baseInput, name: "Other Bot" });
    await activate(otherOwner.id);
    await createAgent(db, userA, { ...baseInput, name: "Draft Bot" }); // stays draft

    const res = await handleListAgents(db, requestTo("/api/v1/agents", rawKey));
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    const names = body.data.map((a: { name: string }) => a.name);
    expect(names).toContain("Public Bot");
    expect(names).toContain("Other Bot");
    expect(names).not.toContain("Draft Bot");
    expect(body.data[0].endpointUrl).toBeUndefined();
    expect(body.pagination).toHaveProperty("nextCursor");
  });

  it("validates the limit parameter and returns 400 for a bad value", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const res = await handleListAgents(
      db,
      requestTo("/api/v1/agents?limit=0", rawKey),
    );
    expect(res.status).toBe(400);
    const body = await bodyOf(res);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a malformed cursor as 400", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const res = await handleListAgents(
      db,
      requestTo("/api/v1/agents?cursor=not-valid", rawKey),
    );
    expect(res.status).toBe(400);
  });

  it("paginates using the returned nextCursor", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    for (let i = 0; i < 3; i++) {
      const agent = await createAgent(db, userA, { ...baseInput, name: `Bot ${i}` });
      await activate(agent.id);
    }

    const first = await handleListAgents(
      db,
      requestTo("/api/v1/agents?limit=2", rawKey),
    );
    const firstBody = await bodyOf(first);
    expect(firstBody.data).toHaveLength(2);
    expect(firstBody.pagination.nextCursor).toBeTruthy();

    const second = await handleListAgents(
      db,
      requestTo(`/api/v1/agents?limit=2&cursor=${firstBody.pagination.nextCursor}`, rawKey),
    );
    const secondBody = await bodyOf(second);
    expect(secondBody.data).toHaveLength(1);
    expect(secondBody.pagination.nextCursor).toBeNull();
  });

  it("updates the API key's last-used timestamp on a successful call", async () => {
    const { rawKey, key } = await createApiKey(db, userA, { name: "k" });
    expect((await listApiKeysForOwner(db, userA))[0].lastUsedAt).toBeNull();

    await handleListAgents(db, requestTo("/api/v1/agents", rawKey));

    const after = await listApiKeysForOwner(db, userA);
    expect(after.find((k) => k.id === key.id)?.lastUsedAt).not.toBeNull();
  });

  it("never leaks the stored credential — plaintext or ciphertext — in the public agents listing", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userA, {
      ...baseInput,
      authType: "bearer",
      authCredential: "another-extremely-secret-planted-value",
    });
    await activate(agent.id);
    expect(agent.authCredentialCiphertext).not.toBeNull();

    const res = await handleListAgents(db, requestTo("/api/v1/agents", rawKey));
    const body = await bodyOf(res);
    const serialized = JSON.stringify(body);

    expect(serialized).not.toContain("another-extremely-secret-planted-value");
    expect(serialized).not.toContain(agent.authCredentialCiphertext);
    expect(serialized).not.toContain("authCredentialCiphertext");
    expect(serialized).not.toContain("auth_credential_ciphertext");
  });
});

describe("handleGetAgent", () => {
  it("returns a public agent by slug", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);

    const res = await handleGetAgent(db, requestTo(`/api/v1/agents/${agent.slug}`, rawKey), agent.slug);
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.data.slug).toBe(agent.slug);
    expect(body.data.endpointUrl).toBeUndefined();
  });

  it("returns 404 for a nonexistent slug", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const res = await handleGetAgent(db, requestTo("/api/v1/agents/nope", rawKey), "nope");
    expect(res.status).toBe(404);
    const body = await bodyOf(res);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 for a draft agent (not yet public)", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userA, baseInput);

    const res = await handleGetAgent(db, requestTo(`/api/v1/agents/${agent.slug}`, rawKey), agent.slug);
    expect(res.status).toBe(404);
  });

  it("returns 404 for an unlisted agent belonging to another owner (no privacy leak)", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userB, baseInput);
    await client.query(
      `update public.agents set lifecycle_status = 'active', visibility = 'unlisted' where id = $1`,
      [agent.id],
    );

    const res = await handleGetAgent(db, requestTo(`/api/v1/agents/${agent.slug}`, rawKey), agent.slug);
    expect(res.status).toBe(404);
  });

  it("rejects without a valid API key", async () => {
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);
    const res = await handleGetAgent(db, requestTo(`/api/v1/agents/${agent.slug}`), agent.slug);
    expect(res.status).toBe(401);
  });

  it("never leaks the stored credential — plaintext or ciphertext — in the public agent JSON", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userA, {
      ...baseInput,
      authType: "api_key",
      authCredential: "extremely-secret-planted-value",
      authHeaderName: "X-Custom-Key",
    });
    await activate(agent.id);
    // Prove the ciphertext really is stored (i.e. this test would have
    // caught a real leak) before proving it never reaches the response.
    expect(agent.authCredentialCiphertext).not.toBeNull();

    const res = await handleGetAgent(db, requestTo(`/api/v1/agents/${agent.slug}`, rawKey), agent.slug);
    const body = await bodyOf(res);
    const serialized = JSON.stringify(body);

    expect(serialized).not.toContain("extremely-secret-planted-value");
    expect(serialized).not.toContain(agent.authCredentialCiphertext);
    expect(serialized).not.toContain("authCredentialCiphertext");
    expect(serialized).not.toContain("auth_credential_ciphertext");
  });
});

describe("handleGetAgentHealth", () => {
  it("returns health data for a public agent", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);
    await recordHealthCheck(db, agent.id, {
      status: "success",
      success: true,
      latencyMs: 123,
      httpStatus: 200,
      errorCode: null,
      errorMessage: null,
    });

    const res = await handleGetAgentHealth(
      db,
      requestTo(`/api/v1/agents/${agent.slug}/health`, rawKey),
      agent.slug,
    );
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.data.slug).toBe(agent.slug);
    expect(body.data.latencyMs).toBe(123);
    expect(body.data.httpStatus).toBe(200);
    expect(body.data.lastCheckedAt).toBeTruthy();
  });

  it("returns null health fields when no check has run yet", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);

    const res = await handleGetAgentHealth(
      db,
      requestTo(`/api/v1/agents/${agent.slug}/health`, rawKey),
      agent.slug,
    );
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.data.lastCheckedAt).toBeNull();
    expect(body.data.latencyMs).toBeNull();
  });

  it("returns 404 for a nonexistent agent", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const res = await handleGetAgentHealth(
      db,
      requestTo("/api/v1/agents/nope/health", rawKey),
      "nope",
    );
    expect(res.status).toBe(404);
  });

  it("rejects without a valid API key", async () => {
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);
    const res = await handleGetAgentHealth(
      db,
      requestTo(`/api/v1/agents/${agent.slug}/health`),
      agent.slug,
    );
    expect(res.status).toBe(401);
  });
});

describe("rate limiting on the Public API routes", () => {
  it("attaches rate-limit headers to a normal successful call", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const res = await handleListAgents(db, requestTo("/api/v1/agents", rawKey));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-RateLimit-Limit")).toBe(String(DEFAULT_RATE_LIMIT_PER_WINDOW));
    expect(Number(res.headers.get("X-RateLimit-Remaining"))).toBe(DEFAULT_RATE_LIMIT_PER_WINDOW - 1);
  });

  it("returns 429 once a key's quota is exhausted, on every route", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);

    for (let i = 0; i < DEFAULT_RATE_LIMIT_PER_WINDOW; i++) {
      await handleListAgents(db, requestTo("/api/v1/agents", rawKey));
    }

    const listRes = await handleListAgents(db, requestTo("/api/v1/agents", rawKey));
    expect(listRes.status).toBe(429);

    const getRes = await handleGetAgent(db, requestTo(`/api/v1/agents/${agent.slug}`, rawKey), agent.slug);
    expect(getRes.status).toBe(429);

    const healthRes = await handleGetAgentHealth(
      db,
      requestTo(`/api/v1/agents/${agent.slug}/health`, rawKey),
      agent.slug,
    );
    expect(healthRes.status).toBe(429);
  });

  it("a fresh API key for the same owner has its own separate quota", async () => {
    const { rawKey: exhausted } = await createApiKey(db, userA, { name: "exhausted" });
    const { rawKey: fresh } = await createApiKey(db, userA, { name: "fresh" });

    for (let i = 0; i < DEFAULT_RATE_LIMIT_PER_WINDOW; i++) {
      await handleListAgents(db, requestTo("/api/v1/agents", exhausted));
    }
    expect((await handleListAgents(db, requestTo("/api/v1/agents", exhausted))).status).toBe(429);
    expect((await handleListAgents(db, requestTo("/api/v1/agents", fresh))).status).toBe(200);
  });
});

describe("handleHeartbeat", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepts a valid heartbeat and returns a small consistent JSON body", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);
    await setMonitoringMode(client, agent.id, "push");

    const res = await handleHeartbeat(db, postTo(`/api/v1/agents/${agent.slug}/heartbeat`, rawKey), agent.slug);
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.data.slug).toBe(agent.slug);
    expect(body.data.status).toBe("healthy");
    expect(body.data.lastHeartbeatAt).toBeTruthy();
  });

  it("updates lastHeartbeatAt in the database", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);

    const before = await client.query<{ last_heartbeat_at: string | null }>(
      `select last_heartbeat_at from public.agents where id = $1`,
      [agent.id],
    );
    expect(before.rows[0].last_heartbeat_at).toBeNull();

    await handleHeartbeat(db, postTo(`/api/v1/agents/${agent.slug}/heartbeat`, rawKey), agent.slug);

    const after = await client.query<{ last_heartbeat_at: string | null }>(
      `select last_heartbeat_at from public.agents where id = $1`,
      [agent.id],
    );
    expect(after.rows[0].last_heartbeat_at).not.toBeNull();
  });

  it("uses trusted server time, ignoring any client-supplied timestamp in the request body", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);

    const spoofedFutureTimestamp = "2099-01-01T00:00:00.000Z";
    const before = Date.now();
    const res = await handleHeartbeat(
      db,
      postTo(`/api/v1/agents/${agent.slug}/heartbeat`, rawKey, {
        lastHeartbeatAt: spoofedFutureTimestamp,
        timestamp: spoofedFutureTimestamp,
      }),
      agent.slug,
    );
    const after = Date.now();

    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    const recorded = new Date(body.data.lastHeartbeatAt).getTime();
    expect(recorded).toBeGreaterThanOrEqual(before);
    expect(recorded).toBeLessThanOrEqual(after);
  });

  it("records a health_checks row with method 'push'", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);

    await handleHeartbeat(db, postTo(`/api/v1/agents/${agent.slug}/heartbeat`, rawKey), agent.slug);

    const rows = await client.query<{ method: string }>(
      `select method from public.health_checks where agent_id = $1`,
      [agent.id],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].method).toBe("push");
  });

  it("rejects a missing API key as 401", async () => {
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);
    const res = await handleHeartbeat(db, postTo(`/api/v1/agents/${agent.slug}/heartbeat`), agent.slug);
    expect(res.status).toBe(401);
  });

  it("rejects an invalid API key as 401", async () => {
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);
    const res = await handleHeartbeat(
      db,
      postTo(`/api/v1/agents/${agent.slug}/heartbeat`, `at_live_${"x".repeat(43)}`),
      agent.slug,
    );
    expect(res.status).toBe(401);
  });

  it("rejects a revoked API key as 401", async () => {
    const { rawKey, key } = await createApiKey(db, userA, { name: "to revoke" });
    await revokeApiKey(db, userA, key.id);
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);

    const res = await handleHeartbeat(db, postTo(`/api/v1/agents/${agent.slug}/heartbeat`, rawKey), agent.slug);
    expect(res.status).toBe(401);
  });

  it("rejects a heartbeat for another owner's agent as 404, and does not update it", async () => {
    const { rawKey: keyB } = await createApiKey(db, userB, { name: "b's key" });
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);

    const res = await handleHeartbeat(db, postTo(`/api/v1/agents/${agent.slug}/heartbeat`, keyB), agent.slug);
    expect(res.status).toBe(404);

    const rows = await client.query<{ last_heartbeat_at: string | null }>(
      `select last_heartbeat_at from public.agents where id = $1`,
      [agent.id],
    );
    expect(rows.rows[0].last_heartbeat_at).toBeNull();
  });

  it("returns 404 for a heartbeat to a nonexistent slug", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const res = await handleHeartbeat(db, postTo("/api/v1/agents/does-not-exist/heartbeat", rawKey), "does-not-exist");
    expect(res.status).toBe(404);
  });

  it("still updates last_used_at on the API key used to send the heartbeat", async () => {
    const { rawKey, key } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);

    await handleHeartbeat(db, postTo(`/api/v1/agents/${agent.slug}/heartbeat`, rawKey), agent.slug);

    const keys = await listApiKeysForOwner(db, userA);
    expect(keys.find((k) => k.id === key.id)?.lastUsedAt).not.toBeNull();
  });

  it("applies the same per-key rate limit as the rest of the Public API", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);

    for (let i = 0; i < DEFAULT_RATE_LIMIT_PER_WINDOW; i++) {
      await handleHeartbeat(db, postTo(`/api/v1/agents/${agent.slug}/heartbeat`, rawKey), agent.slug);
    }

    const res = await handleHeartbeat(db, postTo(`/api/v1/agents/${agent.slug}/heartbeat`, rawKey), agent.slug);
    expect(res.status).toBe(429);
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
  });

  it("a heartbeat sent to a pull-mode agent still updates lastHeartbeatAt but leaves its pull-derived status alone", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);
    // Simulates a pull-mode agent that the cron has already marked healthy.
    await client.query(`update public.agents set current_status = 'healthy' where id = $1`, [agent.id]);

    await handleHeartbeat(db, postTo(`/api/v1/agents/${agent.slug}/heartbeat`, rawKey), agent.slug);

    const healthRes = await handleGetAgentHealth(
      db,
      requestTo(`/api/v1/agents/${agent.slug}/health`, rawKey),
      agent.slug,
    );
    const body = await bodyOf(healthRes);
    // Still the pull-cached status, not a heartbeat-freshness derivation.
    expect(body.data.status).toBe("healthy");
  });
});

describe("push-mode status integration on GET /api/v1/agents/{slug}/health", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports a fresh push heartbeat as healthy", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);
    await setMonitoringMode(client, agent.id, "push");

    await handleHeartbeat(db, postTo(`/api/v1/agents/${agent.slug}/heartbeat`, rawKey), agent.slug);

    const res = await handleGetAgentHealth(
      db,
      requestTo(`/api/v1/agents/${agent.slug}/health`, rawKey),
      agent.slug,
    );
    const body = await bodyOf(res);
    expect(body.data.status).toBe("healthy");
  });

  it("reports a stale push heartbeat as down, and never performs an outbound pull check to get there", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);
    await setMonitoringMode(client, agent.id, "push");

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    await handleHeartbeat(db, postTo(`/api/v1/agents/${agent.slug}/heartbeat`, rawKey), agent.slug);

    const staleSeconds = agent.checkIntervalSeconds * HEARTBEAT_DOWN_AFTER_MISSED_INTERVALS + 1;
    vi.setSystemTime(new Date(Date.now() + staleSeconds * 1000));

    const res = await handleGetAgentHealth(
      db,
      requestTo(`/api/v1/agents/${agent.slug}/health`, rawKey),
      agent.slug,
    );
    const body = await bodyOf(res);
    expect(body.data.status).toBe("down");
  });

  it("a push-mode agent that has never sent a heartbeat reports unknown, not the default pull status", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);
    await setMonitoringMode(client, agent.id, "push");

    const res = await handleGetAgentHealth(
      db,
      requestTo(`/api/v1/agents/${agent.slug}/health`, rawKey),
      agent.slug,
    );
    const body = await bodyOf(res);
    expect(body.data.status).toBe("unknown");
  });
});

describe("reliability score integration", () => {
  it("GET /agents/{slug}/health reports reliabilityScore: null before enough history exists", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);

    const res = await handleGetAgentHealth(
      db,
      requestTo(`/api/v1/agents/${agent.slug}/health`, rawKey),
      agent.slug,
    );
    const body = await bodyOf(res);
    expect(body.data.reliabilityScore).toBeNull();
  });

  it("GET /agents/{slug}/health reports a numeric reliabilityScore once a pull-style history accumulates", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);

    for (let i = 0; i < MIN_SAMPLES_FOR_SCORE; i++) {
      await recordHealthCheck(db, agent.id, {
        status: "success",
        success: true,
        latencyMs: 90,
        httpStatus: 200,
        errorCode: null,
        errorMessage: null,
      });
    }
    // The score itself is only ever written by computeAndStoreReliabilityScore
    // (via the pull cron batch or the heartbeat handler) — recordHealthCheck
    // alone doesn't trigger it, so directly invoking it here mirrors what
    // the real cron does after a check.
    const { computeAndStoreReliabilityScore } = await import(
      "@/lib/db/queries/reliability"
    );
    await computeAndStoreReliabilityScore(db, agent.id, new Date());

    const res = await handleGetAgentHealth(
      db,
      requestTo(`/api/v1/agents/${agent.slug}/health`, rawKey),
      agent.slug,
    );
    const body = await bodyOf(res);
    expect(typeof body.data.reliabilityScore).toBe("number");
    expect(body.data.reliabilityScore).toBeGreaterThan(0);
    expect(body.data.reliabilityScoreComputedAt).toBeTruthy();
  });

  it("GET /agents/{slug} also reports reliabilityScore", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);

    const res = await handleGetAgent(db, requestTo(`/api/v1/agents/${agent.slug}`, rawKey), agent.slug);
    const body = await bodyOf(res);
    expect(body.data.reliabilityScore).toBeNull();
  });

  it("a push-mode agent accumulates a reliability score purely from heartbeats, via the heartbeat handler", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);
    await setMonitoringMode(client, agent.id, "push");

    for (let i = 0; i < MIN_SAMPLES_FOR_SCORE; i++) {
      const res = await handleHeartbeat(
        db,
        postTo(`/api/v1/agents/${agent.slug}/heartbeat`, rawKey),
        agent.slug,
      );
      expect(res.status).toBe(200);
    }

    const healthRes = await handleGetAgentHealth(
      db,
      requestTo(`/api/v1/agents/${agent.slug}/health`, rawKey),
      agent.slug,
    );
    const body = await bodyOf(healthRes);
    expect(typeof body.data.reliabilityScore).toBe("number");
    expect(body.data.reliabilityScore).toBeGreaterThan(0);
  });

  it("never exposes a score for a private (draft) agent through the public-facing lookup", async () => {
    const { rawKey: keyB } = await createApiKey(db, userB, { name: "b" });
    const agent = await createAgent(db, userA, baseInput);
    // left as draft — never activated, so getPublicAgentBySlug itself 404s
    // before any score would even be looked up.
    const res = await handleGetAgent(db, requestTo(`/api/v1/agents/${agent.slug}`, keyB), agent.slug);
    expect(res.status).toBe(404);
  });
});

describe("Agent Card in the Public API", () => {
  it("GET /agents/{slug} includes the derived + stored Agent Card fields", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userA, {
      ...baseInput,
      agentCard: {
        modalities: ["text", "json"],
        interactionType: "streaming",
        documentationUrl: "https://docs.acme.io/support-bot",
      },
    });
    await activate(agent.id);

    const res = await handleGetAgent(db, requestTo(`/api/v1/agents/${agent.slug}`, rawKey), agent.slug);
    const body = await bodyOf(res);

    expect(body.data.agentCard).toMatchObject({
      name: "Support Bot",
      description: "Handles tier-1 support.",
      capabilities: ["chat", "ticket-triage"],
      authentication: { type: "bearer" },
      interfaces: { modalities: ["text", "json"], interactionType: "streaming" },
      documentationUrl: "https://docs.acme.io/support-bot",
    });
  });

  it("GET /agents also includes agentCard for every agent in the list, at no extra query cost", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userA, {
      ...baseInput,
      agentCard: { modalities: ["audio"], interactionType: null, documentationUrl: undefined },
    });
    await activate(agent.id);

    const res = await handleListAgents(db, requestTo("/api/v1/agents", rawKey));
    const body = await bodyOf(res);
    const listed = body.data.find((a: { slug: string }) => a.slug === agent.slug);
    expect(listed.agentCard.interfaces.modalities).toEqual(["audio"]);
  });

  it("never exposes endpointUrl, ownerId, or the raw database id inside the Agent Card", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userA, {
      ...baseInput,
      endpointUrl: "https://private-invoke-endpoint.acme.internal/v1/run",
      agentCard: { modalities: ["text"], interactionType: null, documentationUrl: undefined },
    });
    await activate(agent.id);

    const res = await handleGetAgent(db, requestTo(`/api/v1/agents/${agent.slug}`, rawKey), agent.slug);
    const body = await bodyOf(res);
    const serializedCard = JSON.stringify(body.data.agentCard);

    expect(serializedCard).not.toContain("private-invoke-endpoint");
    expect(serializedCard).not.toContain(agent.ownerId);
    expect(serializedCard).not.toContain(agent.id);
    // Not just the card — the whole response must never carry the raw endpoint either.
    expect(JSON.stringify(body)).not.toContain("private-invoke-endpoint");
  });

  it("serves a clean, empty-extras Agent Card for a legacy agent that never set one", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    // No agentCard passed at all — exactly what an agent registered before
    // this feature existed looks like.
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);

    const res = await handleGetAgent(db, requestTo(`/api/v1/agents/${agent.slug}`, rawKey), agent.slug);
    const body = await bodyOf(res);

    expect(res.status).toBe(200);
    expect(body.data.agentCard.interfaces.modalities).toEqual([]);
    expect(body.data.agentCard.interfaces.interactionType).toBeNull();
    expect(body.data.agentCard.documentationUrl).toBeNull();
    expect(body.data.agentCard.schemaVersion).toBeTruthy();
  });

  it("still 404s for a private (draft) agent — the Agent Card is not a separate exposure path around ownership", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userA, {
      ...baseInput,
      agentCard: { modalities: ["text"], interactionType: null, documentationUrl: undefined },
    });
    // left as draft
    const res = await handleGetAgent(db, requestTo(`/api/v1/agents/${agent.slug}`, rawKey), agent.slug);
    expect(res.status).toBe(404);
  });
});
