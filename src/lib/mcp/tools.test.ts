import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, seedUser } from "@/lib/db/test-harness";
import type { AppDatabase } from "@/lib/db/rls";
import { createAgent } from "@/lib/db/queries/agents";
import { recordHealthCheck } from "@/lib/db/queries/health-checks";
import { createApiKey, revokeApiKey } from "@/lib/db/queries/api-keys";
import { MIN_SAMPLES_FOR_SCORE } from "@/lib/reliability/scoring";
import type { AgentInput } from "@/lib/validation/agent";
import { DEFAULT_RATE_LIMIT_PER_WINDOW } from "@/lib/rate-limit/config";
import {
  getAgentHealthInputSchema,
  getAgentInputSchema,
  listAgentsInputSchema,
  mcpGetAgent,
  mcpGetAgentHealth,
  mcpListAgents,
  mcpSendHeartbeat,
  sendHeartbeatInputSchema,
  type McpToolResult,
} from "./tools";

const userA = "11111111-1111-1111-1111-111111111111";
const userB = "22222222-2222-2222-2222-222222222222";

const baseInput: AgentInput = {
  name: "Support Bot",
  description: "Handles tier-1 support.",
  endpointUrl: "https://agent-private-endpoint.acme.internal/v1/invoke",
  version: "1.0.0",
  capabilities: ["chat", "ticket-triage"],
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

async function setMonitoringMode(agentId: string, mode: "pull" | "push") {
  await client.query(`update public.agents set monitoring_mode = $2 where id = $1`, [
    agentId,
    mode,
  ]);
}

function structured(result: McpToolResult): Record<string, unknown> {
  expect(result.structuredContent).toBeDefined();
  return result.structuredContent!;
}

describe("mcpListAgents", () => {
  it("valid authentication: returns agents visible to the caller", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);

    const result = await mcpListAgents(db, rawKey, {});
    expect(result.isError).toBeUndefined();
    const data = structured(result);
    expect(Array.isArray(data.agents)).toBe(true);
    expect((data.agents as { slug: string }[]).some((a) => a.slug === agent.slug)).toBe(true);
    expect(data.pagination).toHaveProperty("nextCursor");
  });

  it("missing API key fails safely with a structured UNAUTHENTICATED error", async () => {
    const result = await mcpListAgents(db, undefined, {});
    expect(result.isError).toBe(true);
    const data = structured(result);
    expect((data.error as { code: string }).code).toBe("UNAUTHENTICATED");
  });

  it("malformed API key fails safely", async () => {
    const result = await mcpListAgents(db, `at_live_${"z".repeat(43)}`, {});
    expect(result.isError).toBe(true);
    expect((structured(result).error as { code: string }).code).toBe("UNAUTHENTICATED");
  });

  it("revoked API key fails safely", async () => {
    const { rawKey, key } = await createApiKey(db, userA, { name: "to revoke" });
    await revokeApiKey(db, userA, key.id);

    const result = await mcpListAgents(db, rawKey, {});
    expect(result.isError).toBe(true);
    expect((structured(result).error as { code: string }).code).toBe("UNAUTHENTICATED");
  });

  it("excludes draft and unlisted agents from the list", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const draft = await createAgent(db, userA, { ...baseInput, name: "Draft Bot" });
    const unlisted = await createAgent(db, userA, { ...baseInput, name: "Unlisted Bot" });
    await activate(unlisted.id, "unlisted");

    const result = await mcpListAgents(db, rawKey, {});
    const slugs = (structured(result).agents as { slug: string }[]).map((a) => a.slug);
    expect(slugs).not.toContain(draft.slug);
    expect(slugs).not.toContain(unlisted.slug);
  });

  it("paginates via cursor, matching the reused REST pagination behavior", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    for (let i = 0; i < 3; i++) {
      const agent = await createAgent(db, userA, { ...baseInput, name: `Bot ${i}` });
      await activate(agent.id);
    }

    const first = await mcpListAgents(db, rawKey, { limit: 2 });
    const firstData = structured(first);
    expect((firstData.agents as unknown[]).length).toBe(2);
    expect(firstData.pagination).toMatchObject({ nextCursor: expect.any(String) });

    const nextCursor = (firstData.pagination as { nextCursor: string }).nextCursor;
    const second = await mcpListAgents(db, rawKey, { limit: 2, cursor: nextCursor });
    const secondData = structured(second);
    expect((secondData.agents as unknown[]).length).toBe(1);
    expect((secondData.pagination as { nextCursor: string | null }).nextCursor).toBeNull();
  });

  it("rejects an out-of-range limit at the input schema level", () => {
    expect(listAgentsInputSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(listAgentsInputSchema.safeParse({ limit: 1000 }).success).toBe(false);
  });

  it("is subject to the same per-key rate limit as the REST API", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    for (let i = 0; i < DEFAULT_RATE_LIMIT_PER_WINDOW; i++) {
      await mcpListAgents(db, rawKey, {});
    }

    const result = await mcpListAgents(db, rawKey, {});
    expect(result.isError).toBe(true);
    const error = structured(result).error as { code: string; retryAfterSeconds?: number };
    expect(error.code).toBe("RATE_LIMITED");
    expect(typeof error.retryAfterSeconds).toBe("number");
  });

  it("never leaks a private endpointUrl or any agent's raw id/ownerId shape into list output", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);

    const result = await mcpListAgents(db, rawKey, {});
    const text = JSON.stringify(result);
    expect(text).not.toContain("agent-private-endpoint");
  });
});

describe("mcpGetAgent", () => {
  it("valid call returns the same safe representation the Public API serves, including Agent Card", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userA, {
      ...baseInput,
      agentCard: { modalities: ["text"], interactionType: "streaming", documentationUrl: undefined },
    });
    await activate(agent.id);

    const result = await mcpGetAgent(db, rawKey, { slug: agent.slug });
    expect(result.isError).toBeUndefined();
    const data = structured(result);
    expect(data.slug).toBe(agent.slug);
    expect(data.agentCard).toMatchObject({
      interfaces: { modalities: ["text"], interactionType: "streaming" },
    });
    expect(data).toHaveProperty("reliabilityScore");
  });

  it("returns a structured NOT_FOUND error for an unknown slug", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const result = await mcpGetAgent(db, rawKey, { slug: "does-not-exist" });
    expect(result.isError).toBe(true);
    expect((structured(result).error as { code: string }).code).toBe("NOT_FOUND");
  });

  it("hides a draft agent as NOT_FOUND (never leaked, even to its own owner via this tool)", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userA, baseInput); // left draft
    const result = await mcpGetAgent(db, rawKey, { slug: agent.slug });
    expect(result.isError).toBe(true);
    expect((structured(result).error as { code: string }).code).toBe("NOT_FOUND");
  });

  it("hides an unlisted agent as NOT_FOUND", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id, "unlisted");
    const result = await mcpGetAgent(db, rawKey, { slug: agent.slug });
    expect(result.isError).toBe(true);
  });

  it("never exposes endpointUrl, ownerId, key hashes, or other private fields", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);

    const result = await mcpGetAgent(db, rawKey, { slug: agent.slug });
    const data = structured(result);
    // `id` (the agent's own public identifier) is intentionally present —
    // it's `ownerId` (whose account owns it) and the raw endpoint that must
    // never appear anywhere in a public-facing representation.
    expect(data).not.toHaveProperty("ownerId");
    expect(data).not.toHaveProperty("endpointUrl");
    const text = JSON.stringify(result);
    expect(text).not.toContain("agent-private-endpoint");
    expect(text).not.toContain(agent.ownerId);
  });

  it("rejects an empty slug at the input schema level", () => {
    expect(getAgentInputSchema.safeParse({ slug: "" }).success).toBe(false);
  });

  it("rejects an oversized slug at the input schema level", () => {
    expect(getAgentInputSchema.safeParse({ slug: "x".repeat(500) }).success).toBe(false);
  });
});

describe("mcpGetAgentHealth", () => {
  it("pull-mode: reflects the cached currentStatus and latest pull check", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);
    await recordHealthCheck(db, agent.id, {
      status: "success",
      success: true,
      latencyMs: 88,
      httpStatus: 200,
      errorCode: null,
      errorMessage: null,
    });

    const result = await mcpGetAgentHealth(db, rawKey, { slug: agent.slug });
    const data = structured(result);
    expect(data.slug).toBe(agent.slug);
    expect(data.latencyMs).toBe(88);
    expect(data.httpStatus).toBe(200);
  });

  it("push-mode: derives status from heartbeat freshness, not a pull check", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);
    await setMonitoringMode(agent.id, "push");

    await mcpSendHeartbeat(db, rawKey, { slug: agent.slug });

    const result = await mcpGetAgentHealth(db, rawKey, { slug: agent.slug });
    expect(structured(result).status).toBe("healthy");
  });

  it("reliability score present once enough history has accumulated", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);
    await setMonitoringMode(agent.id, "push");

    for (let i = 0; i < MIN_SAMPLES_FOR_SCORE; i++) {
      const res = await mcpSendHeartbeat(db, rawKey, { slug: agent.slug });
      expect(res.isError).toBeUndefined();
    }

    const result = await mcpGetAgentHealth(db, rawKey, { slug: agent.slug });
    const data = structured(result);
    expect(typeof data.reliabilityScore).toBe("number");
    expect(data.reliabilityScore).toBeGreaterThan(0);
  });

  it("reliability score is null (insufficient data), never a fabricated number, for a fresh agent", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);

    const result = await mcpGetAgentHealth(db, rawKey, { slug: agent.slug });
    expect(structured(result).reliabilityScore).toBeNull();
  });

  it("unknown slug -> structured NOT_FOUND", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const result = await mcpGetAgentHealth(db, rawKey, { slug: "nope" });
    expect(result.isError).toBe(true);
    expect((structured(result).error as { code: string }).code).toBe("NOT_FOUND");
  });

  it("rejects malformed (empty) slug input", () => {
    expect(getAgentHealthInputSchema.safeParse({ slug: "" }).success).toBe(false);
    expect(getAgentHealthInputSchema.safeParse({}).success).toBe(false);
  });
});

describe("mcpSendHeartbeat", () => {
  it("valid call updates lastHeartbeatAt using the server's own clock", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);

    const before = Date.now();
    const result = await mcpSendHeartbeat(db, rawKey, { slug: agent.slug });
    const after = Date.now();

    expect(result.isError).toBeUndefined();
    const data = structured(result);
    expect(data.lastHeartbeatAt).toBeTruthy();
    const recorded = new Date(data.lastHeartbeatAt as string).getTime();
    expect(recorded).toBeGreaterThanOrEqual(before);
    expect(recorded).toBeLessThanOrEqual(after);
  });

  it("ignores any client-supplied timestamp field — there isn't one in the schema to begin with", () => {
    // The input schema only ever accepts `slug`; passing anything else is
    // simply dropped by zod's default (non-strict) object parsing, proving
    // there is no field a client could use to influence the timestamp.
    const parsed = sendHeartbeatInputSchema.safeParse({
      slug: "some-agent",
      timestamp: "2099-01-01T00:00:00.000Z",
      lastHeartbeatAt: "2099-01-01T00:00:00.000Z",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ slug: "some-agent" });
  });

  it("ownership: rejects a heartbeat for another owner's agent as NOT_FOUND", async () => {
    const { rawKey: keyB } = await createApiKey(db, userB, { name: "b's key" });
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);

    const result = await mcpSendHeartbeat(db, keyB, { slug: agent.slug });
    expect(result.isError).toBe(true);
    expect((structured(result).error as { code: string }).code).toBe("NOT_FOUND");

    const rows = await client.query<{ last_heartbeat_at: string | null }>(
      `select last_heartbeat_at from public.agents where id = $1`,
      [agent.id],
    );
    expect(rows.rows[0].last_heartbeat_at).toBeNull();
  });

  it("missing API key fails safely without touching the agent", async () => {
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);

    const result = await mcpSendHeartbeat(db, undefined, { slug: agent.slug });
    expect(result.isError).toBe(true);
    expect((structured(result).error as { code: string }).code).toBe("UNAUTHENTICATED");
  });

  it("revoked API key fails safely", async () => {
    const { rawKey, key } = await createApiKey(db, userA, { name: "to revoke" });
    await revokeApiKey(db, userA, key.id);
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);

    const result = await mcpSendHeartbeat(db, rawKey, { slug: agent.slug });
    expect(result.isError).toBe(true);
    expect((structured(result).error as { code: string }).code).toBe("UNAUTHENTICATED");
  });

  it("counts against the same rate limit as the REST heartbeat endpoint", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);

    for (let i = 0; i < DEFAULT_RATE_LIMIT_PER_WINDOW; i++) {
      await mcpSendHeartbeat(db, rawKey, { slug: agent.slug });
    }
    const result = await mcpSendHeartbeat(db, rawKey, { slug: agent.slug });
    expect(result.isError).toBe(true);
    expect((structured(result).error as { code: string }).code).toBe("RATE_LIMITED");
  });
});

describe("deterministic MCP error shape", () => {
  it("every error result has the same {content, structuredContent: {error: {code, message}}, isError: true} shape", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });

    const results = await Promise.all([
      mcpListAgents(db, undefined, {}), // UNAUTHENTICATED
      mcpGetAgent(db, rawKey, { slug: "nope" }), // NOT_FOUND
      mcpGetAgentHealth(db, rawKey, { slug: "nope" }), // NOT_FOUND
      mcpSendHeartbeat(db, rawKey, { slug: "nope" }), // NOT_FOUND
    ]);

    for (const result of results) {
      expect(result.isError).toBe(true);
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content[0].type).toBe("text");
      expect(typeof result.content[0].text).toBe("string");
      const data = structured(result);
      expect(data.error).toBeDefined();
      const error = data.error as { code: string; message: string };
      expect(typeof error.code).toBe("string");
      expect(typeof error.message).toBe("string");
      // Parseable back out of the text content too, not just structuredContent.
      expect(() => JSON.parse(result.content[0].text)).not.toThrow();
    }
  });

  it("never leaks a secret-shaped value (API key hash, pepper-like string) in any tool result, success or error", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userA, baseInput);
    await activate(agent.id);

    const results = await Promise.all([
      mcpListAgents(db, rawKey, {}),
      mcpGetAgent(db, rawKey, { slug: agent.slug }),
      mcpGetAgentHealth(db, rawKey, { slug: agent.slug }),
      mcpSendHeartbeat(db, rawKey, { slug: agent.slug }),
      mcpGetAgent(db, "at_live_" + "y".repeat(43), { slug: agent.slug }),
    ]);

    const allText = JSON.stringify(results);
    expect(allText).not.toContain(rawKey);
    expect(allText).not.toContain("at_live_");
  });
});
