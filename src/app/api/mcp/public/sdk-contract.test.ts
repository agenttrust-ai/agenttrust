import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { AppDatabase } from "@/lib/db/rls";
import { seedUser } from "@/lib/db/test-harness";
import { createAgent } from "@/lib/db/queries/agents";
import { recordHealthCheck } from "@/lib/db/queries/health-checks";
import { computeAndStoreReliabilityScore } from "@/lib/db/queries/reliability";
import { MIN_SAMPLES_FOR_SCORE } from "@/lib/reliability/scoring";
import { ANONYMOUS_RATE_LIMIT_PER_IP } from "@/lib/api/anonymous-rate-limit";
import {
  AgentTrustError,
  NotTrustedError,
  createAgentTrustClient,
} from "../../../../../packages/sdk/src/index";
import { MCP_CURL_REQUEST } from "@/app/docs/quick-start";
import { SDK_EXAMPLE_ENDPOINT } from "@/app/docs/sdk-reference";

// The route imports the app's `db`; point it at an in-memory PGlite
// database so these tests never reach a real one.
const harness = vi.hoisted(() => ({ client: null as unknown as PGlite, db: null as unknown as AppDatabase }));
vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("@/lib/db/test-harness");
  const created = await createTestDb();
  harness.client = created.client;
  harness.db = created.db;
  return { db: created.db };
});

/**
 * Contract test: the TypeScript SDK (packages/sdk) against the real
 * /api/mcp/public route handler, in-process — no network. If the server's
 * check_agent_trust contract drifts from what the SDK parses, this fails.
 */
const PUBLIC_URL = "https://getagenttrust.com/api/mcp/public";
const owner = "55555555-5555-5555-5555-555555555555";
let POST: (req: Request) => Promise<Response>;

beforeAll(async () => {
  POST = (await import("./route")).POST;
  await seedUser(harness.client, owner, "sdk-owner@example.com");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** An SDK client whose fetch calls the route handler directly, as a caller from `ip`. */
function sdkFrom(ip: string) {
  const fetchToRoute = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set("x-vercel-forwarded-for", ip);
    return POST(new Request(String(url), { ...init, headers }));
  }) as typeof fetch;
  return createAgentTrustClient({ endpoint: PUBLIC_URL, fetch: fetchToRoute });
}

async function publicAgentWithScore(endpointUrl: string, name: string) {
  const agent = await createAgent(harness.db, owner, {
    name,
    endpointUrl,
    capabilities: ["chat"],
    authType: "none",
  });
  await harness.client.query(
    `update public.agents set lifecycle_status = 'active', visibility = 'public', current_status = 'healthy' where id = $1`,
    [agent.id],
  );
  for (let i = 0; i < MIN_SAMPLES_FOR_SCORE; i++) {
    await recordHealthCheck(harness.db, agent.id, {
      status: "success",
      success: true,
      latencyMs: 80,
      httpStatus: 200,
      errorCode: null,
      errorMessage: null,
    });
  }
  await computeAndStoreReliabilityScore(harness.db, agent.id, new Date());
  return agent;
}

describe("SDK ↔ /api/mcp/public contract", () => {
  it("parses a real matched result into the typed shape", async () => {
    const agent = await publicAgentWithScore("https://sdk-contract.acme.dev/v1/invoke", "SDK Contract Bot");
    const result = await sdkFrom("198.51.100.60").checkAgentTrust("https://sdk-contract.acme.dev/v1/invoke");

    expect(result).toEqual({
      matched: true,
      slug: agent.slug,
      name: "SDK Contract Bot",
      status: "healthy",
      verified: false,
      reliabilityScore: expect.any(Number),
      reliabilityScoreStatus: "fresh",
      trustDecision: { recommended: true, confidence: "low", reasons: ["Endpoint ownership has not been verified."] },
    });
  });

  it("parses a real unmatched result", async () => {
    expect(await sdkFrom("198.51.100.61").checkAgentTrust("https://never-registered.example.com/mcp")).toEqual({
      matched: false,
    });
  });

  it("parses the real observation status when demand coverage is on", async () => {
    vi.stubEnv("TELEMETRY_HASH_KEY", "s".repeat(48));
    vi.stubEnv("DEMAND_COVERAGE_ENABLED", "true");
    const result = await sdkFrom("198.51.100.62").checkAgentTrust("https://mcp.sdk-unknown.dev/mcp");
    expect(result).toEqual({
      matched: false,
      observation: { status: "pending", message: expect.stringContaining("No score or verification exists yet") },
    });
  });

  it("applies policies to real results: default passes a recommended agent, requireVerified rejects it", async () => {
    await publicAgentWithScore("https://sdk-policy.acme.dev/v1/invoke", "SDK Policy Bot");
    const sdk = sdkFrom("198.51.100.63");

    await expect(sdk.assertTrusted("https://sdk-policy.acme.dev/v1/invoke")).resolves.toMatchObject({ matched: true });
    const error = await sdk.assertTrusted("https://sdk-policy.acme.dev/v1/invoke", { requireVerified: true }).catch((e) => e);
    expect(error).toBeInstanceOf(NotTrustedError);
    expect(error.failures).toEqual(["endpoint ownership is not verified"]);
  });

  it("surfaces the server's real anonymous rate limit as RATE_LIMITED, without bypassing it", async () => {
    const sdk = sdkFrom("198.51.100.64");
    for (let i = 0; i < ANONYMOUS_RATE_LIMIT_PER_IP; i++) {
      await sdk.checkAgentTrust("https://never-registered.example.com/mcp");
    }
    const error = await sdk.checkAgentTrust("https://never-registered.example.com/mcp").catch((e) => e);
    expect(error).toBeInstanceOf(AgentTrustError);
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe("/docs Quick Start curl example ↔ /api/mcp/public", () => {
  it("returns a check_agent_trust result for exactly the request the docs show", async () => {
    const agent = await publicAgentWithScore(
      SDK_EXAMPLE_ENDPOINT,
      "Docs Example Agent",
    );
    const response = await POST(
      new Request(MCP_CURL_REQUEST.url, {
        method: "POST",
        headers: {
          ...MCP_CURL_REQUEST.headers,
          "x-vercel-forwarded-for": "198.51.100.90",
        },
        body: JSON.stringify(MCP_CURL_REQUEST.body),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const data = (await response.text())
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .at(-1);
    const message = JSON.parse(data!.slice("data:".length));
    expect(message.result.isError).toBeUndefined();
    expect(message.result.structuredContent).toMatchObject({
      matched: true,
      slug: agent.slug,
      status: "healthy",
      trustDecision: { recommended: true },
    });
  });
});
