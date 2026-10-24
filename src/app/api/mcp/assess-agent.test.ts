import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { AppDatabase } from "@/lib/db/rls";
import { seedUser } from "@/lib/db/test-harness";
import { createAgent } from "@/lib/db/queries/agents";
import { recordHealthCheck } from "@/lib/db/queries/health-checks";
import { computeAndStoreReliabilityScore } from "@/lib/db/queries/reliability";
import { ANONYMOUS_RATE_LIMIT_PER_IP } from "@/lib/api/anonymous-rate-limit";
import { MIN_SAMPLES_FOR_SCORE } from "@/lib/reliability/scoring";
import { REACHABILITY_IS_NOT_SAFETY } from "@/lib/assessment/assess";
import { mcpRpc } from "@/lib/test/mcp-http";

// Both routes import the app's `db`; point it at an in-memory PGlite
// database so these HTTP-level tests never reach a real one.
const harness = vi.hoisted(() => ({
  client: null as unknown as PGlite,
  db: null as unknown as AppDatabase,
}));
vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("@/lib/db/test-harness");
  const created = await createTestDb();
  harness.client = created.client;
  harness.db = created.db;
  return { db: created.db };
});

// Every outbound path AgentTrust has: the monitor's undici fetch and the
// global fetch. assess_agent must never touch either.
const outbound = vi.hoisted(() => ({ undici: 0 }));
vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return {
    ...actual,
    fetch: (...args: Parameters<typeof actual.fetch>) => {
      outbound.undici++;
      return actual.fetch(...args);
    },
  };
});

type Handler = (req: Request) => Promise<Response>;
const MAIN_URL = "https://getagenttrust.com/api/mcp";
const PUBLIC_URL = "https://getagenttrust.com/api/mcp/public";
const owner = "77777777-7777-7777-7777-777777777777";
let mainPost: Handler;
let publicPost: Handler;
let ipCounter = 10;

beforeAll(async () => {
  mainPost = (await import("./route")).POST;
  publicPost = (await import("./public/route")).POST;
  await seedUser(harness.client, owner, "assess-owner@example.com");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

async function publicAgent(
  endpointUrl: string,
  checks: { success: boolean; at: Date }[],
  scored = false,
) {
  const agent = await createAgent(harness.db, owner, {
    name: "Assess Bot",
    endpointUrl,
    capabilities: ["chat"],
    authType: "none",
  });
  await harness.client.query(
    `update public.agents set lifecycle_status = 'active', visibility = 'public', current_status = $2 where id = $1`,
    [
      agent.id,
      checks[0]?.success === false
        ? "degraded"
        : checks.length
          ? "healthy"
          : "unknown",
    ],
  );
  // Oldest first, so checked_at order matches insertion order.
  for (const check of [...checks].reverse()) {
    await recordHealthCheck(
      harness.db,
      agent.id,
      check.success
        ? {
            status: "success",
            success: true,
            latencyMs: 90,
            httpStatus: 200,
            errorCode: null,
            errorMessage: null,
          }
        : {
            status: "connection_error",
            success: false,
            latencyMs: null,
            httpStatus: null,
            errorCode: "ECONNREFUSED",
            errorMessage: "Connection refused.",
          },
      "pull",
      check.at,
    );
  }
  if (scored)
    await computeAndStoreReliabilityScore(harness.db, agent.id, new Date());
  return agent;
}

type Assessment = {
  matched: boolean;
  decision: string;
  confidence: string;
  reasonCodes: string[];
  reachability: { outcome: string; fresh: boolean };
  historical: { trustDecision: unknown } | null;
  limitations: string[];
  mode: string;
};

async function assess(
  post: Handler,
  url: string,
  endpointUrl: string,
  ip = `203.0.113.${ipCounter++}`,
) {
  const { status, body } = await mcpRpc(
    post,
    url,
    {
      id: 1,
      method: "tools/call",
      params: { name: "assess_agent", arguments: { endpointUrl } },
    },
    { "x-vercel-forwarded-for": ip },
  );
  const result = body.result as {
    isError?: boolean;
    structuredContent: Assessment;
  };
  return { status, result };
}

async function countRows(table: string): Promise<number> {
  const { rows } = await harness.client.query<{ n: number }>(
    `select count(*)::int as n from public.${table}`,
  );
  return rows[0].n;
}

describe("assess_agent on both MCP endpoints", () => {
  it.each([
    ["/api/mcp", () => mainPost, MAIN_URL],
    ["/api/mcp/public", () => publicPost, PUBLIC_URL],
  ] as const)(
    "%s: an unknown URL is insufficient_evidence, and it never contacts the URL or writes demand",
    async (_name, post, url) => {
      // Even with demand coverage on, which makes check_agent_trust queue a lookup.
      vi.stubEnv("TELEMETRY_HASH_KEY", "s".repeat(48));
      vi.stubEnv("DEMAND_COVERAGE_ENABLED", "true");
      const globalFetch = vi.spyOn(globalThis, "fetch");
      const before = {
        undici: outbound.undici,
        observations: await countRows("observation_requests"),
        events: await countRows("trust_check_events"),
      };

      const { status, result } = await assess(
        post(),
        url,
        "https://never-seen.assess.dev/mcp",
      );

      expect(status).toBe(200);
      expect(result.isError ?? false).toBe(false);
      expect(result.structuredContent).toMatchObject({
        matched: false,
        decision: "insufficient_evidence",
        confidence: "none",
        reasonCodes: ["UNKNOWN_ENDPOINT"],
        mode: "cached",
      });
      expect(globalFetch).not.toHaveBeenCalled();
      expect(outbound.undici).toBe(before.undici);
      expect(await countRows("observation_requests")).toBe(before.observations);
      expect(await countRows("trust_check_events")).toBe(before.events);
    },
  );

  it("two successful observations 10+ minutes apart → allow_with_caution (low), never contacting the endpoint", async () => {
    await publicAgent("https://two-checks.assess.dev/v1", [
      { success: true, at: minutesAgo(2) },
      { success: true, at: minutesAgo(30) },
    ]);
    const before = outbound.undici;
    const { result } = await assess(
      publicPost,
      PUBLIC_URL,
      "https://two-checks.assess.dev/v1",
    );
    expect(result.structuredContent).toMatchObject({
      matched: true,
      decision: "allow_with_caution",
      confidence: "low",
      reachability: { outcome: "reachable", fresh: true },
    });
    expect(result.structuredContent.reasonCodes).toContain(
      "INITIAL_OBSERVATIONS_ONLY",
    );
    expect(result.structuredContent.limitations[0]).toBe(
      REACHABILITY_IS_NOT_SAFETY,
    );
    expect(outbound.undici).toBe(before);
  });

  it("one successful observation → insufficient_evidence", async () => {
    await publicAgent("https://one-check.assess.dev/v1", [
      { success: true, at: minutesAgo(1) },
    ]);
    const { result } = await assess(
      publicPost,
      PUBLIC_URL,
      "https://one-check.assess.dev/v1",
    );
    expect(result.structuredContent.decision).toBe("insufficient_evidence");
    expect(result.structuredContent.reasonCodes).toContain("FEW_OBSERVATIONS");
  });

  it("one failed latest observation (connection error) → insufficient_evidence, not avoid", async () => {
    await publicAgent("https://blip.assess.dev/v1", [
      { success: false, at: minutesAgo(5) },
      { success: true, at: minutesAgo(60 * 25) },
    ]);
    const { result } = await assess(
      publicPost,
      PUBLIC_URL,
      "https://blip.assess.dev/v1",
    );
    expect(result.structuredContent.decision).toBe("insufficient_evidence");
    expect(result.structuredContent.reasonCodes).toContain(
      "TRANSIENT_NETWORK_FAILURE",
    );
    expect(result.structuredContent.reachability.outcome).toBe("unreachable");
  });

  it("two consecutive failed observations → avoid (persistent failure)", async () => {
    await publicAgent("https://failing.assess.dev/v1", [
      { success: false, at: minutesAgo(5) },
      { success: false, at: minutesAgo(60 * 25) },
      { success: true, at: minutesAgo(60 * 49) },
    ]);
    const { result } = await assess(
      publicPost,
      PUBLIC_URL,
      "https://failing.assess.dev/v1",
    );
    expect(result.structuredContent.decision).toBe("avoid");
    expect(result.structuredContent.reasonCodes).toContain(
      "PERSISTENT_FAILURE",
    );
  });

  it("a draft (not public, active) agent is treated as unknown", async () => {
    const agent = await createAgent(harness.db, owner, {
      name: "Draft Bot",
      endpointUrl: "https://draft.assess.dev/v1",
      capabilities: [],
      authType: "none",
    });
    await recordHealthCheck(
      harness.db,
      agent.id,
      {
        status: "success",
        success: true,
        latencyMs: 90,
        httpStatus: 200,
        errorCode: null,
        errorMessage: null,
      },
      "pull",
      minutesAgo(1),
    );
    const { result } = await assess(
      publicPost,
      PUBLIC_URL,
      "https://draft.assess.dev/v1",
    );
    expect(result.structuredContent).toMatchObject({
      matched: false,
      decision: "insufficient_evidence",
    });
  });

  it("returns exactly the trustDecision check_agent_trust returns, and changes no stored evidence", async () => {
    const agent = await publicAgent(
      "https://scored.assess.dev/v1",
      Array.from({ length: MIN_SAMPLES_FOR_SCORE }, (_, i) => ({
        success: true,
        at: minutesAgo(5 + i * 60),
      })),
      true,
    );
    const snapshot = async () =>
      (
        await harness.client.query(
          `select (select count(*) from public.health_checks where agent_id = $1)::int as checks,
                  (select count(*) from public.reliability_scores where agent_id = $1)::int as scores,
                  (select current_status from public.agents where id = $1) as status,
                  (select updated_at from public.agents where id = $1) as updated`,
          [agent.id],
        )
      ).rows[0];
    const before = await snapshot();

    const { result } = await assess(
      mainPost,
      MAIN_URL,
      "https://scored.assess.dev/v1",
    );
    const { body } = await mcpRpc(
      mainPost,
      MAIN_URL,
      {
        id: 2,
        method: "tools/call",
        params: {
          name: "check_agent_trust",
          arguments: { endpointUrl: "https://scored.assess.dev/v1" },
        },
      },
      { "x-vercel-forwarded-for": `203.0.113.${ipCounter++}` },
    );
    const check = (
      body.result as { structuredContent: { trustDecision: unknown } }
    ).structuredContent;

    expect(result.structuredContent.historical?.trustDecision).toEqual(
      check.trustDecision,
    );
    expect(result.structuredContent).toMatchObject({
      decision: "allow_with_caution",
    });
    expect(result.structuredContent.reasonCodes).toContain(
      "SUFFICIENT_HISTORY",
    );
    expect(await snapshot()).toEqual(before);
  });

  it("shares check_agent_trust's anonymous per-IP rate limit", async () => {
    const ip = "198.51.100.200";
    for (let i = 0; i < ANONYMOUS_RATE_LIMIT_PER_IP; i++) {
      const { result } = await assess(
        publicPost,
        PUBLIC_URL,
        "https://never-seen.assess.dev/rl",
        ip,
      );
      expect(result.isError ?? false).toBe(false);
    }
    const { result } = await assess(
      publicPost,
      PUBLIC_URL,
      "https://never-seen.assess.dev/rl",
      ip,
    );
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: { code: "RATE_LIMITED" },
    });
    expect(JSON.stringify(result)).toMatch(/retryAfterSeconds/);
  });

  it("logs one audit line per assessment, without the URL", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await assess(
      publicPost,
      PUBLIC_URL,
      "https://secret-path.assess.dev/private?token=abc",
    );
    const lines = info.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes("agent_assessment"));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({
      event: "agent_assessment",
      surface: "mcp_public",
      matched: false,
      decision: "insufficient_evidence",
      reasonCodes: ["UNKNOWN_ENDPOINT"],
    });
    expect(lines[0]).not.toContain("secret-path");
    expect(lines[0]).not.toContain("token");
  });

  it("rejects a malformed URL on the public endpoint before rate limiting or lookup", async () => {
    const { body } = await mcpRpc(
      publicPost,
      PUBLIC_URL,
      {
        id: 3,
        method: "tools/call",
        params: {
          name: "assess_agent",
          arguments: { endpointUrl: "not a url" },
        },
      },
      { "x-vercel-forwarded-for": "198.51.100.201" },
    );
    const result = body.result as {
      isError?: boolean;
      content: { text: string }[];
    };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(
      /absolute http:\/\/ or https:\/\/ URL/,
    );
  });
});
