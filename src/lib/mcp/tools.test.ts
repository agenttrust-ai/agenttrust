import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, seedUser } from "@/lib/db/test-harness";
import type { AppDatabase } from "@/lib/db/rls";
import { createAgent } from "@/lib/db/queries/agents";
import { recordHealthCheck } from "@/lib/db/queries/health-checks";
import { createApiKey, revokeApiKey } from "@/lib/db/queries/api-keys";
import { MIN_SAMPLES_FOR_SCORE } from "@/lib/reliability/scoring";
import { STALE_SCORE_REASON } from "@/lib/reliability/trust-decision";
import type { AgentInput } from "@/lib/validation/agent";
import { DEFAULT_RATE_LIMIT_PER_WINDOW } from "@/lib/rate-limit/config";
import {
  checkAgentTrustInputSchema,
  checkAgentTrustOutputSchema,
  getAgentHealthInputSchema,
  getAgentHealthOutputSchema,
  getAgentInputSchema,
  getAgentOutputSchema,
  listAgentsInputSchema,
  mcpCheckAgentTrust,
  mcpGetAgent,
  mcpGetAgentHealth,
  mcpListAgents,
  mcpSendHeartbeat,
  sendHeartbeatInputSchema,
  type McpToolResult,
} from "./tools";
import { ANONYMOUS_RATE_LIMIT_PER_IP } from "@/lib/api/anonymous-rate-limit";
import advertisedToolsList from "@/app/api/mcp/__snapshots__/tools-list.json";

const userA = "11111111-1111-1111-1111-111111111111";
const userB = "22222222-2222-2222-2222-222222222222";

const baseInput: AgentInput = {
  name: "Support Bot",
  description: "Handles tier-1 support.",
  endpointUrl: "https://agent-private-endpoint.acme.internal/v1/invoke",
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

  describe("discovery by endpoint URL", () => {
    it("finds the agent registered with the given endpoint URL", async () => {
      const { rawKey } = await createApiKey(db, userA, { name: "k" });
      const agent = await createAgent(db, userA, {
        ...baseInput,
        name: "MCP Findable Bot",
        endpointUrl: "https://mcp-discover.example.com/v1/invoke",
      });
      await activate(agent.id);

      const result = await mcpListAgents(db, rawKey, {
        endpointUrl: "https://mcp-discover.example.com/v1/invoke",
      });
      expect(result.isError).toBeUndefined();
      const data = structured(result);
      expect((data.agents as { slug: string }[]).map((a) => a.slug)).toEqual([agent.slug]);
    });

    it("returns an empty list, not an error, for an unregistered endpoint URL", async () => {
      const { rawKey } = await createApiKey(db, userA, { name: "k" });

      const result = await mcpListAgents(db, rawKey, {
        endpointUrl: "https://mcp-nothing-here.example.com/nope",
      });
      expect(result.isError).toBeUndefined();
      expect(structured(result).agents).toEqual([]);
    });

    it("still excludes draft agents, even for their exact registered URL", async () => {
      const { rawKey } = await createApiKey(db, userA, { name: "k" });
      await createAgent(db, userA, {
        ...baseInput,
        name: "MCP Draft Bot",
        endpointUrl: "https://mcp-draft.example.com/v1/invoke",
      }); // left as draft

      const result = await mcpListAgents(db, rawKey, {
        endpointUrl: "https://mcp-draft.example.com/v1/invoke",
      });
      expect(structured(result).agents).toEqual([]);
    });

    it("rejects an endpointUrl input longer than the schema allows", () => {
      expect(
        listAgentsInputSchema.safeParse({ endpointUrl: "https://x.example.com/" + "a".repeat(2100) })
          .success,
      ).toBe(false);
    });

    it("still works with no endpointUrl given — existing callers unaffected", async () => {
      const { rawKey } = await createApiKey(db, userA, { name: "k" });
      const agent = await createAgent(db, userA, baseInput);
      await activate(agent.id);

      const result = await mcpListAgents(db, rawKey, {});
      expect(result.isError).toBeUndefined();
      const slugs = (structured(result).agents as { slug: string }[]).map((a) => a.slug);
      expect(slugs).toContain(agent.slug);
    });

    it("includes trustDecision and supporting signals when looking up by endpointUrl (trust check)", async () => {
      const { rawKey } = await createApiKey(db, userA, { name: "k" });
      const agent = await createAgent(db, userA, {
        ...baseInput,
        name: "MCP Trust Check Bot",
        endpointUrl: "https://mcp-trust-check.example.com/v1/invoke",
      });
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
      const { computeAndStoreReliabilityScore } = await import("@/lib/db/queries/reliability");
      await computeAndStoreReliabilityScore(db, agent.id, new Date());
      await client.query(`update public.agents set current_status = 'healthy' where id = $1`, [
        agent.id,
      ]);

      const result = await mcpListAgents(db, rawKey, {
        endpointUrl: "https://mcp-trust-check.example.com/v1/invoke",
      });
      const data = structured(result);
      const [found] = data.agents as Array<{
        trustDecision: { recommended: boolean; confidence: string; reasons: string[] };
        reliabilityScore: number | null;
        verified: boolean;
      }>;
      expect(found.trustDecision).toMatchObject({ recommended: true, confidence: "low" }); // unverified
      expect(typeof found.reliabilityScore).toBe("number");
      expect(found.verified).toBe(false);
    });

    it("does not include trustDecision when no endpointUrl is given — plain listing unaffected", async () => {
      const { rawKey } = await createApiKey(db, userA, { name: "k" });
      const agent = await createAgent(db, userA, { ...baseInput, name: "MCP Plain Bot" });
      await activate(agent.id);

      const result = await mcpListAgents(db, rawKey, {});
      const data = structured(result);
      const found = (data.agents as Array<{ name: string; trustDecision?: unknown }>).find(
        (a) => a.name === "MCP Plain Bot",
      );
      expect(found).toBeDefined();
      expect(found!.trustDecision).toBeUndefined();
    });
  });
});

/**
 * The output schemas /api/mcp advertises in `tools/list` (pinned in
 * tools-list.json, which route.test.ts checks against the live handler).
 * A client may validate `structuredContent` against these, so every real
 * result must satisfy them — including `additionalProperties: false`.
 */
type JsonSchema = {
  type?: string | string[];
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
};

function advertisedOutputSchema(toolName: string): JsonSchema {
  const tool = (advertisedToolsList.tools as unknown as Array<{ name: string; outputSchema: JsonSchema }>).find(
    (t) => t.name === toolName,
  );
  expect(tool).toBeDefined();
  return tool!.outputSchema;
}

function jsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** Strict check of the JSON Schema keywords these output schemas use. */
function schemaViolations(schema: JsonSchema, value: unknown, path = "$"): string[] {
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const ok = types.some((t) =>
      t === "integer" ? Number.isInteger(value) : t === jsonType(value),
    );
    if (!ok) return [`${path}: expected ${types.join("|")}, got ${jsonType(value)}`];
  }
  if (schema.enum && !schema.enum.includes(value)) return [`${path}: ${String(value)} not in enum`];
  const violations: string[] = [];
  if (jsonType(value) === "object") {
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in record)) violations.push(`${path}.${key}: required but missing`);
    }
    for (const [key, child] of Object.entries(record)) {
      const childSchema = schema.properties?.[key];
      if (childSchema) violations.push(...schemaViolations(childSchema, child, `${path}.${key}`));
      else if (schema.additionalProperties === false) violations.push(`${path}.${key}: not allowed by the schema`);
    }
  }
  if (jsonType(value) === "array" && schema.items) {
    (value as unknown[]).forEach((item, i) => violations.push(...schemaViolations(schema.items!, item, `${path}[${i}]`)));
  }
  return violations;
}

describe("advertised output schemas accept the real results", () => {
  async function seedScoredAgent(rawName: string, endpointUrl: string) {
    const agent = await createAgent(db, userA, { ...baseInput, name: rawName, endpointUrl });
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
    const { computeAndStoreReliabilityScore } = await import("@/lib/db/queries/reliability");
    await computeAndStoreReliabilityScore(db, agent.id, new Date());
    return agent;
  }

  async function makeExternallyObserved(agentId: string) {
    await client.query(
      `update public.agents set source = 'externally_observed', owner_id = null, external_registry_id = 'test-registry-id' where id = $1`,
      [agentId],
    );
  }

  it("list_agents (plain listing, both sources): every agent satisfies the schema, source included", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    await seedScoredAgent("Schema Owned Bot", "https://schema-owned.example.com/v1/invoke");
    const observed = await seedScoredAgent("Schema Observed Bot", "https://schema-observed.example.com/v1/invoke");
    await makeExternallyObserved(observed.id);

    const data = structured(await mcpListAgents(db, rawKey, {}));
    const sources = (data.agents as Array<{ source: string }>).map((a) => a.source).sort();
    expect(sources).toEqual(["externally_observed", "owner_registered"]);
    expect(schemaViolations(advertisedOutputSchema("list_agents"), data)).toEqual([]);
  });

  it("list_agents (endpointUrl trust check): the enriched agent satisfies the schema, source included", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    await seedScoredAgent("Schema Lookup Bot", "https://schema-lookup.example.com/v1/invoke");

    const data = structured(
      await mcpListAgents(db, rawKey, { endpointUrl: "https://schema-lookup.example.com/v1/invoke" }),
    );
    const [found] = data.agents as Array<{ source: string; trustDecision?: unknown }>;
    expect(found.source).toBe("owner_registered");
    expect(found.trustDecision).toBeDefined();
    expect(schemaViolations(advertisedOutputSchema("list_agents"), data)).toEqual([]);
  });

  it("get_agent: the result satisfies the schema, source included", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await seedScoredAgent("Schema Get Bot", "https://schema-get.example.com/v1/invoke");

    const data = structured(await mcpGetAgent(db, rawKey, { slug: agent.slug }));
    expect(data.source).toBe("owner_registered");
    expect(schemaViolations(advertisedOutputSchema("get_agent"), data)).toEqual([]);
  });

  it("the checker itself rejects a field the schema does not allow", () => {
    expect(schemaViolations({ type: "object", properties: {}, additionalProperties: false }, { extra: 1 })).toEqual([
      "$.extra: not allowed by the schema",
    ]);
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
    expect(data).toHaveProperty("trustDecision");
    expect(data.trustDecision).toMatchObject({
      recommended: expect.any(Boolean),
      confidence: expect.any(String),
      reasons: expect.any(Array),
    });
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

describe("mcpCheckAgentTrust", () => {
  function requestFromIp(ip: string): Request {
    return new Request("https://agenttrust-umber.vercel.app/api/mcp", {
      headers: { "x-vercel-forwarded-for": ip },
    });
  }

  it("works with no Authorization header at all — that's the entire point of this tool", async () => {
    const agent = await createAgent(db, userA, {
      ...baseInput,
      name: "Anon Findable Bot",
      endpointUrl: "https://anon-findable.example.com/v1/invoke",
    });
    await activate(agent.id);

    const request = requestFromIp("203.0.113.201");
    const result = await mcpCheckAgentTrust(db, request, {
      endpointUrl: "https://anon-findable.example.com/v1/invoke",
    });
    expect(result.isError).toBeUndefined();
    expect(structured(result).matched).toBe(true);
  });

  it("returns exactly the minimal public subset, with trustDecision, for a known public+active agent", async () => {
    const agent = await createAgent(db, userA, {
      ...baseInput,
      name: "Anon Trust Bot",
      endpointUrl: "https://anon-trust.example.com/v1/invoke",
    });
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
    const { computeAndStoreReliabilityScore } = await import("@/lib/db/queries/reliability");
    await computeAndStoreReliabilityScore(db, agent.id, new Date());
    await client.query(`update public.agents set current_status = 'healthy' where id = $1`, [
      agent.id,
    ]);

    const result = await mcpCheckAgentTrust(db, requestFromIp("203.0.113.202"), {
      endpointUrl: "https://anon-trust.example.com/v1/invoke",
    });
    const data = structured(result);
    expect(Object.keys(data).sort()).toEqual(
      [
        "matched",
        "name",
        "reliabilityScore",
        "reliabilityScoreStatus",
        "slug",
        "status",
        "trustDecision",
        "verified",
      ].sort(),
    );
    expect(data.slug).toBe(agent.slug);
    expect(data.name).toBe("Anon Trust Bot");
    expect(data.status).toBe("healthy");
    expect(data.verified).toBe(false);
    expect(typeof data.reliabilityScore).toBe("number");
    expect(data.reliabilityScoreStatus).toBe("fresh");
    expect(data.trustDecision).toMatchObject({ recommended: true, confidence: "low" });
  });

  it("matches a normalization variant of the stored endpoint, and returns the newest when several agents share it", async () => {
    const older = await createAgent(db, userA, {
      ...baseInput,
      name: "Anon Shared Older",
      endpointUrl: "https://Anon-Shared.example.com:443/a2a/",
    });
    const newer = await createAgent(db, userB, {
      ...baseInput,
      name: "Anon Shared Newer",
      endpointUrl: "https://anon-shared.example.com/a2a",
    });
    await activate(older.id);
    await activate(newer.id);
    await client.query(`update public.agents set created_at = '2026-09-01T00:00:00Z' where id = $1`, [older.id]);
    await client.query(`update public.agents set created_at = '2026-09-02T00:00:00Z' where id = $1`, [newer.id]);

    const result = await mcpCheckAgentTrust(db, requestFromIp("203.0.113.231"), {
      endpointUrl: "HTTPS://anon-shared.EXAMPLE.com/a2a/",
    });
    expect(result.isError).toBeUndefined();
    const data = structured(result);
    expect(data).toMatchObject({ matched: true, slug: newer.slug, name: "Anon Shared Newer" });
    expect(checkAgentTrustOutputSchema.safeParse(data).success).toBe(true);

    // With the newer one unlisted, the same query falls through to the older one.
    await activate(newer.id, "unlisted");
    const fallback = structured(
      await mcpCheckAgentTrust(db, requestFromIp("203.0.113.232"), {
        endpointUrl: "https://anon-shared.example.com/a2a",
      }),
    );
    expect(fallback).toMatchObject({ matched: true, slug: older.slug });
  });

  it("returns a clean { matched: false } for an unregistered endpoint — never an error", async () => {
    const result = await mcpCheckAgentTrust(db, requestFromIp("203.0.113.203"), {
      endpointUrl: "https://anon-nothing-here.example.com/nope",
    });
    expect(result.isError).toBeUndefined();
    expect(structured(result)).toEqual({ matched: false });
  });

  it("cannot discover a draft agent — same clean no-match result as an unregistered URL", async () => {
    await createAgent(db, userA, {
      ...baseInput,
      name: "Anon Draft Bot",
      endpointUrl: "https://anon-draft.example.com/v1/invoke",
    }); // left as draft

    const result = await mcpCheckAgentTrust(db, requestFromIp("203.0.113.204"), {
      endpointUrl: "https://anon-draft.example.com/v1/invoke",
    });
    expect(structured(result)).toEqual({ matched: false });
  });

  it("cannot discover an unlisted agent — same clean no-match result", async () => {
    const agent = await createAgent(db, userA, {
      ...baseInput,
      name: "Anon Unlisted Bot",
      endpointUrl: "https://anon-unlisted.example.com/v1/invoke",
    });
    await activate(agent.id, "unlisted");

    const result = await mcpCheckAgentTrust(db, requestFromIp("203.0.113.205"), {
      endpointUrl: "https://anon-unlisted.example.com/v1/invoke",
    });
    expect(structured(result)).toEqual({ matched: false });
  });

  it("never exposes ownerId, credentials, verification tokens, or any other private field", async () => {
    const agent = await createAgent(db, userA, {
      ...baseInput,
      name: "Anon Private Fields Bot",
      endpointUrl: "https://anon-private-fields.example.com/v1/invoke",
    });
    await activate(agent.id);

    const result = await mcpCheckAgentTrust(db, requestFromIp("203.0.113.206"), {
      endpointUrl: "https://anon-private-fields.example.com/v1/invoke",
    });
    const data = structured(result);
    for (const forbidden of [
      "ownerId",
      "authCredentialCiphertext",
      "ownershipVerificationToken",
      "endpointUrl",
      "id",
      "agentCard",
      "capabilities",
      "createdAt",
    ]) {
      expect(data).not.toHaveProperty(forbidden);
    }
    const text = JSON.stringify(result);
    expect(text).not.toContain(agent.ownerId);
    expect(text).not.toContain("anon-private-fields.example.com");
  });

  it("never exposes a verified agent's challenge token — only the verified result", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userA, {
      ...baseInput,
      name: "Anon Token Bot",
      endpointUrl: "https://anon-token.example.com/v1/invoke",
    });
    await activate(agent.id);
    const token = "c".repeat(48);
    await client.query(
      `update public.agents set ownership_verification_token = $2, ownership_verified_at = now() where id = $1`,
      [agent.id, token],
    );

    const trust = await mcpCheckAgentTrust(db, requestFromIp("203.0.113.207"), {
      endpointUrl: "https://anon-token.example.com/v1/invoke",
    });
    expect(structured(trust).verified).toBe(true);
    const outputs = [
      trust,
      await mcpGetAgent(db, rawKey, { slug: agent.slug }),
      await mcpGetAgentHealth(db, rawKey, { slug: agent.slug }),
    ];
    for (const output of outputs) {
      const serialized = JSON.stringify(output);
      expect(serialized).not.toContain(token);
      expect(serialized).not.toContain("ownershipVerificationToken");
    }
  });

  it("rejects empty endpointUrl at the schema level", () => {
    expect(checkAgentTrustInputSchema.safeParse({ endpointUrl: "" }).success).toBe(false);
    expect(checkAgentTrustInputSchema.safeParse({}).success).toBe(false);
  });

  it("rejects an oversized endpointUrl at the schema level", () => {
    expect(
      checkAgentTrustInputSchema.safeParse({
        endpointUrl: "https://x.example.com/" + "a".repeat(2100),
      }).success,
    ).toBe(false);
  });

  it("handles a malformed (not-a-URL) endpointUrl safely as a clean no-match, never an error or a crash", async () => {
    const result = await mcpCheckAgentTrust(db, requestFromIp("203.0.113.207"), {
      endpointUrl: "not-a-url-at-all",
    });
    expect(result.isError).toBeUndefined();
    expect(structured(result)).toEqual({ matched: false });
  });

  it("accepts no listing/search/pagination/cursor parameters — the schema has no such fields", () => {
    const shape = checkAgentTrustInputSchema.shape;
    expect(Object.keys(shape)).toEqual(["endpointUrl"]);
  });

  it("makes zero outbound HTTP requests during the lookup", async () => {
    const agent = await createAgent(db, userA, {
      ...baseInput,
      name: "Anon No Fetch Bot",
      endpointUrl: "https://anon-no-fetch.example.com/v1/invoke",
    });
    await activate(agent.id);

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      await mcpCheckAgentTrust(db, requestFromIp("203.0.113.208"), {
        endpointUrl: "https://anon-no-fetch.example.com/v1/invoke",
      });
      await mcpCheckAgentTrust(db, requestFromIp("203.0.113.209"), {
        endpointUrl: "https://anon-unregistered-no-fetch.example.com/nope",
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("enforces the per-IP anonymous rate limit, with a structured RATE_LIMITED error and retryAfterSeconds", async () => {
    const request = requestFromIp("203.0.113.210");
    for (let i = 0; i < ANONYMOUS_RATE_LIMIT_PER_IP; i++) {
      const result = await mcpCheckAgentTrust(db, request, {
        endpointUrl: "https://anon-rate-limit.example.com/nope",
      });
      expect(result.isError).toBeUndefined();
    }

    const blocked = await mcpCheckAgentTrust(db, request, {
      endpointUrl: "https://anon-rate-limit.example.com/nope",
    });
    expect(blocked.isError).toBe(true);
    const error = structured(blocked).error as { code: string; retryAfterSeconds?: number };
    expect(error.code).toBe("RATE_LIMITED");
    expect(typeof error.retryAfterSeconds).toBe("number");
    expect(error.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("fails closed (rejects, never treats as unlimited) when no trustworthy IP header is present", async () => {
    const requestWithNoIp = new Request("https://agenttrust-umber.vercel.app/api/mcp");
    const result = await mcpCheckAgentTrust(db, requestWithNoIp, {
      endpointUrl: "https://anon-no-ip.example.com/nope",
    });
    expect(result.isError).toBe(true);
    expect((structured(result).error as { code: string }).code).toBe("RATE_LIMITED");
  });

  it("different anonymous callers (by IP) get independent quota — one caller's usage never blocks another", async () => {
    const requestA = requestFromIp("203.0.113.220");
    for (let i = 0; i < ANONYMOUS_RATE_LIMIT_PER_IP; i++) {
      await mcpCheckAgentTrust(db, requestA, { endpointUrl: "https://anon-independent.example.com/nope" });
    }
    expect((await mcpCheckAgentTrust(db, requestA, { endpointUrl: "https://anon-independent.example.com/nope" })).isError).toBe(true);

    const requestB = requestFromIp("203.0.113.221");
    const resultB = await mcpCheckAgentTrust(db, requestB, {
      endpointUrl: "https://anon-independent.example.com/nope",
    });
    expect(resultB.isError).toBeUndefined();
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

describe("reliability score freshness in MCP tool output", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const HOUR = 60 * 60 * 1000;

  function requestFromIp(ip: string): Request {
    return new Request("https://getagenttrust.com/api/mcp", {
      headers: { "x-vercel-forwarded-for": ip },
    });
  }

  async function checkAt(agentId: string, when: Date) {
    await recordHealthCheck(
      db,
      agentId,
      { status: "success", success: true, latencyMs: 100, httpStatus: 200, errorCode: null, errorMessage: null },
      "pull",
      when,
    );
  }

  /** A healthy public agent whose only score was computed 9 days ago from checks that have all aged out. */
  async function staleScoredAgent(endpointUrl: string) {
    const agent = await createAgent(db, userA, { ...baseInput, name: "Stale Mcp Bot", endpointUrl });
    await activate(agent.id);
    const scoredAt = new Date(Date.now() - 9 * DAY);
    for (let i = 0; i < MIN_SAMPLES_FOR_SCORE; i++) await checkAt(agent.id, new Date(scoredAt.getTime() - i * HOUR));
    const { computeAndStoreReliabilityScore } = await import("@/lib/db/queries/reliability");
    await computeAndStoreReliabilityScore(db, agent.id, scoredAt);
    await client.query(`update public.agents set current_status = 'healthy' where id = $1`, [agent.id]);
    const [row] = (
      await client.query<{ score: string }>(`select score from public.reliability_scores where agent_id = $1`, [agent.id])
    ).rows;
    return { agent, historicalScore: Number(row!.score) };
  }

  it("check_agent_trust: stale score keeps its historical value, is marked stale, and is never recommended", async () => {
    const url = "https://stale-mcp-trust.example.com/invoke";
    const { historicalScore } = await staleScoredAgent(url);

    const result = await mcpCheckAgentTrust(db, requestFromIp("203.0.113.231"), { endpointUrl: url });
    const data = structured(result);

    expect(data.matched).toBe(true);
    expect(data.reliabilityScore).toBe(historicalScore);
    expect(data.reliabilityScoreStatus).toBe("stale");
    expect(data.trustDecision).toEqual({
      recommended: false,
      confidence: "insufficient_data",
      reasons: expect.arrayContaining([STALE_SCORE_REASON]),
    });
    expect(checkAgentTrustOutputSchema.safeParse(data).success).toBe(true);
  });

  it("check_agent_trust: matched:false output is unchanged (no score fields)", async () => {
    const result = await mcpCheckAgentTrust(db, requestFromIp("203.0.113.232"), {
      endpointUrl: "https://nothing-registered-here.example.com/invoke",
    });
    expect(structured(result)).toEqual({ matched: false });
  });

  it("get_agent: stale score keeps its historical value, is marked stale, and is never recommended", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const { agent, historicalScore } = await staleScoredAgent("https://stale-mcp-get.example.com/invoke");

    const result = await mcpGetAgent(db, rawKey, { slug: agent.slug });
    const data = structured(result);

    expect(data.reliabilityScore).toBe(historicalScore);
    expect(data.reliabilityScoreStatus).toBe("stale");
    expect((data.trustDecision as { recommended: boolean }).recommended).toBe(false);
    expect(getAgentOutputSchema.safeParse(data).success).toBe(true);
  });

  it("get_agent_health: stale score keeps its historical value and is marked stale", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const { agent, historicalScore } = await staleScoredAgent("https://stale-mcp-health.example.com/invoke");

    const result = await mcpGetAgentHealth(db, rawKey, { slug: agent.slug });
    const data = structured(result);

    expect(data.reliabilityScore).toBe(historicalScore);
    expect(data.reliabilityScoreStatus).toBe("stale");
    expect(getAgentHealthOutputSchema.safeParse(data).success).toBe(true);
  });

  /** The 2026-09-27 production shape: five samples, scored 12h ago, oldest since aged out of a 7-day window ending now. */
  async function boundaryScoredAgent(endpointUrl: string) {
    const agent = await createAgent(db, userA, { ...baseInput, name: "Boundary Mcp Bot", endpointUrl });
    await activate(agent.id);
    const run = new Date(Date.now() - 12 * HOUR);
    for (const ago of [7 * DAY - 1500, 4 * DAY, 2 * DAY, DAY]) await checkAt(agent.id, new Date(run.getTime() - ago));
    await checkAt(agent.id, run);
    const { computeAndStoreReliabilityScore } = await import("@/lib/db/queries/reliability");
    await computeAndStoreReliabilityScore(db, agent.id, run);
    await client.query(`update public.agents set current_status = 'healthy' where id = $1`, [agent.id]);
    return agent;
  }

  it("check_agent_trust boundary regression: stays fresh, drives trustDecision, same output shape", async () => {
    const url = "https://boundary-mcp-trust.example.com/invoke";
    await boundaryScoredAgent(url);

    const result = await mcpCheckAgentTrust(db, requestFromIp("203.0.113.233"), { endpointUrl: url });
    const data = structured(result);

    expect(data.reliabilityScoreStatus).toBe("fresh");
    expect(typeof data.reliabilityScore).toBe("number");
    expect(data.trustDecision).toEqual({
      recommended: true,
      confidence: "low",
      reasons: ["Endpoint ownership has not been verified."],
    });
    expect(Object.keys(data).sort()).toEqual([
      "matched", "name", "reliabilityScore", "reliabilityScoreStatus", "slug", "status", "trustDecision", "verified",
    ]);
    expect(checkAgentTrustOutputSchema.safeParse(data).success).toBe(true);
  });

  it("get_agent and get_agent_health boundary regression: fresh, and still valid against their output schemas", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await boundaryScoredAgent("https://boundary-mcp-get.example.com/invoke");

    const got = structured(await mcpGetAgent(db, rawKey, { slug: agent.slug }));
    expect(got.reliabilityScoreStatus).toBe("fresh");
    expect((got.trustDecision as { recommended: boolean }).recommended).toBe(true);
    expect(getAgentOutputSchema.safeParse(got).success).toBe(true);

    const health = structured(await mcpGetAgentHealth(db, rawKey, { slug: agent.slug }));
    expect(health.reliabilityScoreStatus).toBe("fresh");
    expect(getAgentHealthOutputSchema.safeParse(health).success).toBe(true);
  });

  it("output schemas accept exactly the three freshness values", () => {
    for (const value of ["none", "fresh", "stale"]) {
      expect(
        checkAgentTrustOutputSchema.safeParse({ matched: true, reliabilityScoreStatus: value }).success,
      ).toBe(true);
    }
  });

  it("output schemas reject an unknown freshness value", () => {
    expect(
      checkAgentTrustOutputSchema.safeParse({ matched: true, reliabilityScoreStatus: "expired" }).success,
    ).toBe(false);
  });
});

describe("check_agent_trust usage telemetry", () => {
  const KEY = "t".repeat(48);
  const originalKey = process.env.TELEMETRY_HASH_KEY;
  beforeEach(() => {
    process.env.TELEMETRY_HASH_KEY = KEY;
  });
  afterEach(() => {
    if (originalKey === undefined) delete process.env.TELEMETRY_HASH_KEY;
    else process.env.TELEMETRY_HASH_KEY = originalKey;
  });

  function request(ip: string, userAgent = "claude-code/1.2.3"): Request {
    return new Request("https://getagenttrust.com/api/mcp", {
      headers: {
        "x-vercel-forwarded-for": ip,
        "user-agent": userAgent,
        authorization: "Bearer at_live_should_never_be_stored",
      },
    });
  }

  /** Collects scheduled telemetry so a test can run it deterministically. */
  function capture() {
    const tasks: (() => Promise<void>)[] = [];
    return {
      schedule: (task: () => Promise<void>) => {
        tasks.push(task);
      },
      flush: async () => {
        for (const task of tasks.splice(0)) await task();
      },
      pending: () => tasks.length,
    };
  }

  async function events() {
    return (
      await client.query<Record<string, unknown>>(
        `select surface, outcome, agent_id, recommended, confidence, endpoint_host,
                endpoint_key, caller_key, client_family
           from public.trust_check_events order by occurred_at`,
      )
    ).rows;
  }

  async function knownAgent(endpointUrl: string) {
    const agent = await createAgent(db, userA, { ...baseInput, name: "Telemetry Bot", endpointUrl });
    await activate(agent.id);
    return agent;
  }

  it("returns a byte-identical response whether telemetry runs, fails, or is unconfigured", async () => {
    await knownAgent("https://telemetry-same.example.com/v1/invoke");
    const input = { endpointUrl: "https://telemetry-same.example.com/v1/invoke" };

    const recorded = capture();
    const withTelemetry = await mcpCheckAgentTrust(db, request("203.0.113.61"), input, {
      scheduleTelemetry: recorded.schedule,
    });
    await recorded.flush();
    const failing = await mcpCheckAgentTrust(db, request("203.0.113.62"), input, {
      scheduleTelemetry: () => {
        throw new Error("scheduler exploded");
      },
    });
    delete process.env.TELEMETRY_HASH_KEY;
    const noKey = capture();
    const unconfigured = await mcpCheckAgentTrust(db, request("203.0.113.63"), input, {
      scheduleTelemetry: noKey.schedule,
    });
    await noKey.flush();

    expect(JSON.stringify(failing)).toBe(JSON.stringify(withTelemetry));
    expect(JSON.stringify(unconfigured)).toBe(JSON.stringify(withTelemetry));
    expect(checkAgentTrustOutputSchema.safeParse(structured(withTelemetry)).success).toBe(true);
    expect(Object.keys(structured(withTelemetry)).sort()).toEqual([
      "matched", "name", "reliabilityScore", "reliabilityScoreStatus", "slug", "status", "trustDecision", "verified",
    ]);
  });

  it("doesn't record before the response — only when the scheduled task runs", async () => {
    const queued = capture();
    await mcpCheckAgentTrust(db, request("203.0.113.64"), { endpointUrl: "https://nobody.example.com/a" }, {
      scheduleTelemetry: queued.schedule,
    });
    expect(queued.pending()).toBe(1);
    expect(await events()).toHaveLength(0);
    await queued.flush();
    expect(await events()).toHaveLength(1);
  });

  it("records a matched check with the agent and its trustDecision, and no endpoint data", async () => {
    const agent = await knownAgent("https://telemetry-matched.example.com/v1/invoke");
    const queued = capture();
    const result = await mcpCheckAgentTrust(
      db,
      request("203.0.113.65"),
      { endpointUrl: "https://telemetry-matched.example.com/v1/invoke" },
      { scheduleTelemetry: queued.schedule },
    );
    await queued.flush();

    const decision = structured(result).trustDecision as { recommended: boolean; confidence: string };
    const [row] = await events();
    expect(row).toMatchObject({
      surface: "mcp",
      outcome: "matched",
      agent_id: agent.id,
      recommended: decision.recommended,
      confidence: decision.confidence,
      endpoint_host: null,
      endpoint_key: null,
      client_family: "claude-code",
    });
    expect(row.caller_key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("records an unmatched check as a sanitized host plus keyed hash — no URL, query, fragment, IP or credential", async () => {
    const queued = capture();
    await mcpCheckAgentTrust(
      db,
      request("198.51.100.77"),
      { endpointUrl: "https://Unknown-Agent.io/private/path?token=secret123#frag" },
      { scheduleTelemetry: queued.schedule },
    );
    await queued.flush();

    const [row] = await events();
    expect(row).toMatchObject({
      surface: "mcp",
      outcome: "not_matched",
      agent_id: null,
      recommended: null,
      confidence: null,
      endpoint_host: "unknown-agent.io",
    });
    expect(row.endpoint_key).toMatch(/^[0-9a-f]{64}$/);
    const stored = JSON.stringify(row);
    for (const forbidden of ["/private/path", "secret123", "token", "#frag", "198.51.100.77", "at_live_", "Bearer"]) {
      expect(stored).not.toContain(forbidden);
    }
  });

  it("omits the host for IP literals, localhost and internal names, but still counts the check", async () => {
    const queued = capture();
    for (const endpointUrl of [
      "https://203.0.113.9/agent",
      "https://localhost/agent",
      "https://svc.cluster.internal/agent",
    ]) {
      await mcpCheckAgentTrust(db, request("203.0.113.66"), { endpointUrl }, { scheduleTelemetry: queued.schedule });
    }
    await queued.flush();
    const rows = await events();
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.outcome === "not_matched" && r.endpoint_host === null)).toBe(true);
  });

  it("labels the web check surface separately from MCP", async () => {
    const queued = capture();
    await mcpCheckAgentTrust(db, request("203.0.113.67", "Mozilla/5.0 (Macintosh)"), {
      endpointUrl: "https://nobody-web.example.com/a",
    }, { surface: "web", scheduleTelemetry: queued.schedule });
    await queued.flush();
    expect((await events())[0]).toMatchObject({ surface: "web", client_family: "mozilla" });
  });

  it("without TELEMETRY_HASH_KEY still records, with no caller or endpoint hashes", async () => {
    delete process.env.TELEMETRY_HASH_KEY;
    const queued = capture();
    await mcpCheckAgentTrust(db, request("203.0.113.68"), { endpointUrl: "https://nobody-nokey.io/a" }, {
      scheduleTelemetry: queued.schedule,
    });
    await queued.flush();
    expect((await events())[0]).toMatchObject({
      outcome: "not_matched",
      endpoint_host: "nobody-nokey.io",
      endpoint_key: null,
      caller_key: null,
    });
  });

  it("doesn't record rate-limited calls", async () => {
    const queued = capture();
    for (let i = 0; i <= ANONYMOUS_RATE_LIMIT_PER_IP; i++) {
      await mcpCheckAgentTrust(db, request("203.0.113.69"), { endpointUrl: "https://nobody-flood.io/a" }, {
        scheduleTelemetry: queued.schedule,
      });
    }
    expect(queued.pending()).toBe(ANONYMOUS_RATE_LIMIT_PER_IP);
  });

  it("a telemetry storage failure never affects the check", async () => {
    await client.query(`drop table public.trust_check_events`);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const queued = capture();
    const result = await mcpCheckAgentTrust(db, request("203.0.113.70"), { endpointUrl: "https://nobody-broken.io/a" }, {
      scheduleTelemetry: queued.schedule,
    });
    await expect(queued.flush()).resolves.toBeUndefined();
    expect(structured(result)).toEqual({ matched: false });
    expect(JSON.stringify(errors.mock.calls)).not.toContain("nobody-broken.io");
    errors.mockRestore();
  });

  it("never contacts the checked endpoint, before or after the response", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const queued = capture();
    await mcpCheckAgentTrust(db, request("203.0.113.71"), { endpointUrl: "https://never-contact.io/a" }, {
      scheduleTelemetry: queued.schedule,
    });
    await queued.flush();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
