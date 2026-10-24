import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, seedUser } from "@/lib/db/test-harness";
import type { AppDatabase } from "@/lib/db/rls";
import { createAgent } from "@/lib/db/queries/agents";
import { createApiKey } from "@/lib/db/queries/api-keys";
import { recordHealthCheck } from "@/lib/db/queries/health-checks";
import { handleGetAssessment } from "./assessments";

// assess never makes an outbound request; count any attempt on the
// monitor's undici fetch and on the global fetch.
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

const userA = "88888888-8888-8888-8888-888888888888";

let client: PGlite;
let db: AppDatabase;

beforeEach(async () => {
  const harness = await createTestDb();
  client = harness.client;
  db = harness.db;
  await seedUser(client, userA, "a@example.com");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await client.close();
});

function get(query: string, apiKey?: string): Request {
  const headers = new Headers();
  if (apiKey) headers.set("authorization", `Bearer ${apiKey}`);
  return new Request(`https://example.com/api/v1/assessments${query}`, {
    headers,
  });
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

describe("GET /api/v1/assessments", () => {
  it("requires an API key", async () => {
    const res = await handleGetAssessment(
      db,
      get("?endpoint_url=https%3A%2F%2Fx.example.com"),
    );
    expect(res.status).toBe(401);
  });

  it("requires endpoint_url", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const res = await handleGetAssessment(db, get("", rawKey));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("returns { data: assessment } for an unknown endpoint, with no outbound request", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const globalFetch = vi.spyOn(globalThis, "fetch");
    const before = outbound.undici;
    const res = await handleGetAssessment(
      db,
      get("?endpoint_url=https%3A%2F%2Fnever.example.com%2Fmcp", rawKey),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      data: {
        matched: false,
        decision: "insufficient_evidence",
        reasonCodes: ["UNKNOWN_ENDPOINT"],
        mode: "cached",
      },
    });
    expect(globalFetch).not.toHaveBeenCalled();
    expect(outbound.undici).toBe(before);
  });

  it("assesses a registered public agent from its stored checks", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "k" });
    const agent = await createAgent(db, userA, {
      name: "Rest Bot",
      endpointUrl: "https://rest.assess.dev/v1",
      capabilities: [],
      authType: "none",
    });
    await client.query(
      `update public.agents set lifecycle_status = 'active', visibility = 'public', current_status = 'healthy' where id = $1`,
      [agent.id],
    );
    for (const at of [minutesAgo(40), minutesAgo(3)]) {
      await recordHealthCheck(
        db,
        agent.id,
        {
          status: "success",
          success: true,
          latencyMs: 70,
          httpStatus: 405,
          errorCode: null,
          errorMessage: null,
        },
        "pull",
        at,
      );
    }
    const res = await handleGetAssessment(
      db,
      get("?endpoint_url=https%3A%2F%2Frest.assess.dev%2Fv1", rawKey),
    );
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({
      matched: true,
      decision: "allow_with_caution",
      confidence: "low",
      reachability: { outcome: "reachable", httpStatus: 405 },
      initialRisk: {
        observations: {
          attempts: 2,
          successfulStreak: 2,
          streakSpanMinutes: 37,
        },
      },
      agent: { slug: agent.slug, source: "owner_registered", verified: false },
    });
  });
});
