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

  it("output schemas reject an unknown freshness value", () => {
    expect(
      checkAgentTrustOutputSchema.safeParse({ matched: true, reliabilityScoreStatus: "expired" }).success,
    ).toBe(false);
  });
});
