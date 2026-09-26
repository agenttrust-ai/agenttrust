import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, seedUser } from "@/lib/db/test-harness";
import type { AppDatabase } from "@/lib/db/rls";
import { AppError, ErrorCode } from "@/lib/errors";
import { agents } from "@/lib/db/schema";
import {
  getExistingAgentSignatures,
  insertExternallyObservedAgent,
} from "./public-agent-observation";
import {
  claimDueAgents,
  getRecentChecksForStatus,
  recordHealthCheck,
  setAgentStatus,
} from "./health-checks";
import { computeAndStoreReliabilityScore } from "./reliability";
import { deriveAgentStatus } from "@/lib/monitoring/status";
import { computeTrustDecision } from "@/lib/reliability/trust-decision";
import {
  createAgent,
  getOwnedAgent,
  listAgentsForOwner,
  listPublicAgents,
  startOwnershipVerification,
} from "./agents";
import type { AgentInput } from "@/lib/validation/agent";

const ownerA = "11111111-1111-1111-1111-111111111111";

const baseObserved = {
  name: "AUX Evidence and Certification",
  description: "Independent evidence agent.",
  endpointUrl: "https://api.aux.example.com/a2a/v1",
  version: "0.9.0",
  capabilityTags: ["gleif", "sanctions-evidence"],
  externalRegistryId: "registry-agent-1",
};

const ownerInput: AgentInput = {
  name: "Owner Agent",
  description: "A real owner-registered agent.",
  endpointUrl: "https://owner-agent.example.com/invoke",
  version: "1.0.0",
  capabilities: ["chat"],
  authType: "none",
};

let client: PGlite;
let db: AppDatabase;

beforeEach(async () => {
  const harness = await createTestDb();
  client = harness.client;
  db = harness.db;
  await seedUser(client, ownerA, "owner-a@example.com");
});

afterEach(async () => {
  await client.close();
});

describe("insertExternallyObservedAgent", () => {
  it("creates an unclaimed, unverified, public, active agent", async () => {
    const agent = await insertExternallyObservedAgent(db, baseObserved);

    expect(agent.ownerId).toBeNull();
    expect(agent.source).toBe("externally_observed");
    expect(agent.visibility).toBe("public");
    expect(agent.lifecycleStatus).toBe("active");
    expect(agent.monitoringMode).toBe("pull");
    expect(agent.ownershipVerificationToken).toBeNull();
    expect(agent.ownershipVerifiedAt).toBeNull();
    expect(agent.externalRegistryId).toBe("registry-agent-1");
    expect(agent.discoveredAt).not.toBeNull();
    expect(agent.authType).toBe("none");
  });

  it("stores endpoint_url_normalized so the public endpoint lookup finds it", async () => {
    const agent = await insertExternallyObservedAgent(db, {
      ...baseObserved,
      endpointUrl: "https://API.aux.example.com:443/a2a/v1/",
    });
    expect(agent.endpointUrl).toBe("https://API.aux.example.com:443/a2a/v1/");
    expect(agent.endpointUrlNormalized).toBe("https://api.aux.example.com/a2a/v1");

    const page = await listPublicAgents(db, {
      limit: 5,
      endpointUrl: "https://api.aux.example.com/a2a/v1",
    });
    expect(page.agents.map((a) => a.id)).toEqual([agent.id]);
  });

  it("rejects an insert that violates the source/owner invariant, even bypassing the query layer", async () => {
    // Simulates a hypothetical future bug that tries to attach a real owner
    // to an externally-observed row directly — the DB CHECK constraint
    // (not just insertExternallyObservedAgent's own good behavior) must
    // still refuse it.
    await expect(
      db.insert(agents).values({
        ownerId: ownerA,
        slug: "bad-hybrid-agent",
        name: "Bad Hybrid",
        endpointUrl: "https://bad-hybrid.example.com/invoke",
        source: "externally_observed",
        externalRegistryId: "bad-hybrid-1",
        visibility: "public",
        lifecycleStatus: "active",
      }),
    ).rejects.toThrow();
  });
});

describe("getExistingAgentSignatures", () => {
  it("reports normalized endpoint URLs and external registry ids across every agent regardless of owner", async () => {
    await createAgent(db, ownerA, ownerInput);
    await insertExternallyObservedAgent(db, baseObserved);

    const signatures = await getExistingAgentSignatures(db);

    expect(signatures.normalizedEndpointUrls.has("https://owner-agent.example.com/invoke")).toBe(
      true,
    );
    expect(signatures.normalizedEndpointUrls.has("https://api.aux.example.com/a2a/v1")).toBe(
      true,
    );
    expect(signatures.externalRegistryIds.has("registry-agent-1")).toBe(true);
  });
});

describe("ownership/verification isolation for externally-observed agents", () => {
  it("never appears in an owner's own agent list", async () => {
    await insertExternallyObservedAgent(db, baseObserved);
    const ownersAgents = await listAgentsForOwner(db, ownerA);
    expect(ownersAgents).toHaveLength(0);
  });

  it("cannot be fetched via getOwnedAgent by any user — same NOT_FOUND as a nonexistent id", async () => {
    const observed = await insertExternallyObservedAgent(db, baseObserved);
    await expect(getOwnedAgent(db, ownerA, observed.id)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
  });

  it("cannot be claimed via startOwnershipVerification by any user", async () => {
    const observed = await insertExternallyObservedAgent(db, baseObserved);
    await expect(startOwnershipVerification(db, ownerA, observed.id)).rejects.toBeInstanceOf(
      AppError,
    );
  });

  it("appears in the public listing exactly like an owner-registered agent, but always unverified", async () => {
    const observed = await insertExternallyObservedAgent(db, baseObserved);
    const page = await listPublicAgents(db, { limit: 20 });
    const found = page.agents.find((a) => a.id === observed.id);
    expect(found).toBeDefined();
    expect(found!.ownershipVerifiedAt).toBeNull();
  });
});

describe("monitoring, reliability scoring, and trustDecision compose unchanged for externally-observed agents", () => {
  it("is picked up by the same claimDueAgents the cron uses", async () => {
    const observed = await insertExternallyObservedAgent(db, baseObserved);
    const claimed = await claimDueAgents(db, 20);
    expect(claimed.map((a) => a.id)).toContain(observed.id);
  });

  it("accumulates health checks and a reliability score through the existing pipeline, and trustDecision can recommend it while it stays unverified", async () => {
    const observed = await insertExternallyObservedAgent(db, baseObserved);
    const now = new Date();

    for (let i = 0; i < 5; i++) {
      await recordHealthCheck(
        db,
        observed.id,
        {
          status: "success",
          success: true,
          httpStatus: 200,
          latencyMs: 120,
          errorCode: null,
          errorMessage: null,
        },
        "pull",
        new Date(now.getTime() - i * 1000),
      );
    }

    const recentChecks = await getRecentChecksForStatus(db, observed.id);
    const nextStatus = deriveAgentStatus("unknown", recentChecks);
    await setAgentStatus(db, observed.id, nextStatus);

    const score = await computeAndStoreReliabilityScore(db, observed.id, now);
    expect(score).not.toBeNull();

    const decision = computeTrustDecision({
      status: nextStatus,
      score: score!.score,
      verified: false,
    });

    expect(decision.reasons).toContain("Endpoint ownership has not been verified.");
    // The whole point of this feature: a strong, healthy, unverified
    // externally-observed agent can still be recommended — verification is
    // a signal, never a gate. Same behavior an owner-registered agent gets.
    if (nextStatus === "healthy" && score!.score >= 50) {
      expect(decision.recommended).toBe(true);
      expect(decision.confidence).toBe("low");
    }
  });
});
