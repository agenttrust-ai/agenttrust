import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, seedUser } from "@/lib/db/test-harness";
import type { AppDatabase } from "@/lib/db/rls";
import { createAgent } from "@/lib/db/queries/agents";
import { insertExternallyObservedAgent } from "@/lib/db/queries/public-agent-observation";
import type { AgentInput } from "@/lib/validation/agent";
import type { A2ARegistryAgent } from "./a2a-registry";
import { RegistryFetchError } from "./a2a-registry";

vi.mock("./a2a-registry", async () => {
  const actual = await vi.importActual<typeof import("./a2a-registry")>("./a2a-registry");
  return { ...actual, fetchA2ARegistryAgents: vi.fn() };
});

import { fetchA2ARegistryAgents } from "./a2a-registry";
import { importPublicAgents } from "./import-public-agents";

const mockedFetch = vi.mocked(fetchA2ARegistryAgents);

const ownerA = "11111111-1111-1111-1111-111111111111";

function candidate(overrides: Partial<A2ARegistryAgent> = {}): A2ARegistryAgent {
  return {
    id: "registry-1",
    name: "Evidence Agent",
    description: "An A2A agent.",
    url: "https://api.example-registry-agent.com/a2a/v1",
    version: "1.0.0",
    skills: [{ tags: ["gleif", "Sanctions Evidence!"] }],
    hidden: false,
    flag_count: 0,
    ...overrides,
  };
}

let client: PGlite;
let db: AppDatabase;

beforeEach(async () => {
  const harness = await createTestDb();
  client = harness.client;
  db = harness.db;
  await seedUser(client, ownerA, "owner-a@example.com");
  mockedFetch.mockReset();
});

afterEach(async () => {
  await client.close();
});

describe("importPublicAgents", () => {
  it("discovers, validates, and inserts a valid candidate, normalizing its capability tags", async () => {
    mockedFetch.mockResolvedValue([candidate()]);

    const summary = await importPublicAgents(db, { fetchLimit: 50, insertLimit: 10 });

    expect(summary.discovered).toBe(1);
    expect(summary.inserted).toHaveLength(1);
    const inserted = summary.inserted[0]!;
    expect(inserted.source).toBe("externally_observed");
    expect(inserted.ownerId).toBeNull();
    expect(inserted.externalRegistryId).toBe("registry-1");
    // "Sanctions Evidence!" is normalized to a valid lowercase-hyphen tag,
    // never dropped just for not already matching the dashboard's own format.
    expect(inserted.capabilityTags).toContain("gleif");
    expect(inserted.capabilityTags).toContain("sanctions-evidence");
    expect(summary.filtered).toHaveLength(0);
    expect(summary.duplicatesSkipped).toHaveLength(0);
  });

  it("filters out a hidden candidate", async () => {
    mockedFetch.mockResolvedValue([candidate({ hidden: true })]);
    const summary = await importPublicAgents(db, { fetchLimit: 50, insertLimit: 10 });
    expect(summary.inserted).toHaveLength(0);
    expect(summary.filtered).toEqual([
      expect.objectContaining({ reason: "hidden", registryId: "registry-1" }),
    ]);
  });

  it("filters out a flagged candidate", async () => {
    mockedFetch.mockResolvedValue([candidate({ flag_count: 2 })]);
    const summary = await importPublicAgents(db, { fetchLimit: 50, insertLimit: 10 });
    expect(summary.inserted).toHaveLength(0);
    expect(summary.filtered).toEqual([
      expect.objectContaining({ reason: "flagged" }),
    ]);
  });

  it("filters out a candidate whose endpoint is an unsafe/private URL (SSRF)", async () => {
    mockedFetch.mockResolvedValue([
      candidate({ id: "registry-ssrf", url: "https://169.254.169.254/latest/meta-data" }),
      candidate({ id: "registry-localhost", url: "https://localhost:8080/invoke" }),
    ]);
    const summary = await importPublicAgents(db, { fetchLimit: 50, insertLimit: 10 });
    expect(summary.inserted).toHaveLength(0);
    expect(summary.filtered).toHaveLength(2);
    for (const skipped of summary.filtered) {
      expect(skipped.reason).toBe("validation_failed");
    }
  });

  it("filters out a candidate with an invalid/malformed endpoint URL", async () => {
    mockedFetch.mockResolvedValue([candidate({ url: "not-a-url" })]);
    const summary = await importPublicAgents(db, { fetchLimit: 50, insertLimit: 10 });
    expect(summary.inserted).toHaveLength(0);
    expect(summary.filtered).toEqual([
      expect.objectContaining({ reason: "validation_failed" }),
    ]);
  });

  it("filters out a non-https endpoint URL the same way registration would", async () => {
    mockedFetch.mockResolvedValue([
      candidate({ url: "http://api.example-registry-agent.com/a2a/v1" }),
    ]);
    const summary = await importPublicAgents(db, { fetchLimit: 50, insertLimit: 10 });
    expect(summary.inserted).toHaveLength(0);
    expect(summary.filtered[0]?.reason).toBe("validation_failed");
  });

  it("skips a candidate whose endpoint duplicates an existing owner-registered agent", async () => {
    const ownerInput: AgentInput = {
      name: "Existing Owner Agent",
      endpointUrl: "https://api.example-registry-agent.com/a2a/v1",
      capabilities: [],
      authType: "none",
    };
    await createAgent(db, ownerA, ownerInput);

    mockedFetch.mockResolvedValue([candidate()]);
    const summary = await importPublicAgents(db, { fetchLimit: 50, insertLimit: 10 });

    expect(summary.inserted).toHaveLength(0);
    expect(summary.duplicatesSkipped).toEqual([
      expect.objectContaining({ reason: "duplicate_endpoint" }),
    ]);
  });

  it("skips a candidate whose endpoint duplicates an already-imported externally-observed agent", async () => {
    await insertExternallyObservedAgent(db, {
      name: "Already Imported",
      endpointUrl: "https://api.example-registry-agent.com/a2a/v1",
      capabilityTags: [],
      externalRegistryId: "already-imported-1",
    });

    mockedFetch.mockResolvedValue([candidate({ id: "registry-new-id" })]);
    const summary = await importPublicAgents(db, { fetchLimit: 50, insertLimit: 10 });

    expect(summary.inserted).toHaveLength(0);
    expect(summary.duplicatesSkipped).toEqual([
      expect.objectContaining({ reason: "duplicate_endpoint" }),
    ]);
  });

  it("skips re-importing the same registry id on a re-run, even without checking the URL", async () => {
    await insertExternallyObservedAgent(db, {
      name: "Evidence Agent",
      endpointUrl: "https://api.example-registry-agent.com/a2a/v1",
      capabilityTags: [],
      externalRegistryId: "registry-1",
    });

    mockedFetch.mockResolvedValue([candidate({ id: "registry-1" })]);
    const summary = await importPublicAgents(db, { fetchLimit: 50, insertLimit: 10 });

    expect(summary.inserted).toHaveLength(0);
    expect(summary.duplicatesSkipped).toEqual([
      expect.objectContaining({ reason: "duplicate_registry_id" }),
    ]);
  });

  it("never inserts two candidates in the same batch that share an endpoint URL", async () => {
    mockedFetch.mockResolvedValue([
      candidate({ id: "registry-1" }),
      candidate({ id: "registry-2" }),
    ]);
    const summary = await importPublicAgents(db, { fetchLimit: 50, insertLimit: 10 });
    expect(summary.inserted).toHaveLength(1);
    expect(summary.duplicatesSkipped).toEqual([
      expect.objectContaining({ registryId: "registry-2", reason: "duplicate_endpoint" }),
    ]);
  });

  it("respects insertLimit, counting the rest as capped rather than inserting or filtering them", async () => {
    mockedFetch.mockResolvedValue([
      candidate({ id: "r1", url: "https://a1.example.com/invoke" }),
      candidate({ id: "r2", url: "https://a2.example.com/invoke" }),
      candidate({ id: "r3", url: "https://a3.example.com/invoke" }),
    ]);
    const summary = await importPublicAgents(db, { fetchLimit: 50, insertLimit: 2 });
    expect(summary.discovered).toBe(3);
    expect(summary.inserted).toHaveLength(2);
    expect(summary.cappedBeforeInsert).toEqual([
      expect.objectContaining({ registryId: "r3", reason: "insert_cap_reached" }),
    ]);
  });

  it("fails closed and inserts nothing when the registry fetch fails", async () => {
    mockedFetch.mockRejectedValue(new RegistryFetchError("Couldn't reach the public agent registry."));

    await expect(
      importPublicAgents(db, { fetchLimit: 50, insertLimit: 10 }),
    ).rejects.toBeInstanceOf(RegistryFetchError);

    const signatures = await import("@/lib/db/queries/public-agent-observation").then((m) =>
      m.getExistingAgentSignatures(db),
    );
    expect(signatures.externalRegistryIds.size).toBe(0);
  });
});
