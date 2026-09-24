import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, seedUser } from "@/lib/db/test-harness";
import type { AppDatabase } from "@/lib/db/rls";
import { createAgent } from "@/lib/db/queries/agents";
import type { AgentInput } from "@/lib/validation/agent";
import { toTrustEnrichedAgentJson } from "@/lib/api/agents";
import type { McpRegistryEntry } from "./mcp-registry";
import { McpRegistryFetchError } from "./mcp-registry";

vi.mock("./mcp-registry", async () => {
  const actual = await vi.importActual<typeof import("./mcp-registry")>("./mcp-registry");
  return { ...actual, fetchMcpRegistryServers: vi.fn() };
});

vi.mock("@/lib/db/queries/public-agent-observation", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/db/queries/public-agent-observation")
  >("@/lib/db/queries/public-agent-observation");
  return { ...actual, insertExternallyObservedAgent: vi.fn(actual.insertExternallyObservedAgent) };
});

import { fetchMcpRegistryServers } from "./mcp-registry";
import {
  insertExternallyObservedAgent,
  getExistingAgentSignatures,
} from "@/lib/db/queries/public-agent-observation";
import {
  importMcpRegistryAgents,
  MCP_DISCOVERY_DAILY_INSERT_CAP,
} from "./import-mcp-registry-agents";

const mockedFetch = vi.mocked(fetchMcpRegistryServers);
const mockedInsert = vi.mocked(insertExternallyObservedAgent);

const ownerA = "11111111-1111-1111-1111-111111111111";

function entry(overrides: {
  name?: string;
  title?: string;
  description?: string;
  version?: string;
  remotes?: { type: string; url?: string }[];
  status?: string;
}): McpRegistryEntry {
  return {
    server: {
      name: overrides.name ?? "io.github.example/agent",
      title: overrides.title ?? "Example Agent",
      description: overrides.description ?? "An MCP agent.",
      version: overrides.version ?? "1.0.0",
      remotes: overrides.remotes ?? [
        { type: "streamable-http", url: "https://api.example-mcp-agent.com/mcp" },
      ],
    },
    status: overrides.status ?? "active",
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
  mockedInsert.mockClear();
});

afterEach(async () => {
  await client.close();
});

describe("importMcpRegistryAgents", () => {
  it("discovers, validates, and inserts a valid candidate", async () => {
    mockedFetch.mockResolvedValue([entry({})]);

    const summary = await importMcpRegistryAgents(db, { fetchLimit: 50 });

    expect(summary.sourceCandidates).toBe(1);
    expect(summary.validCandidates).toBe(1);
    expect(summary.inserted).toHaveLength(1);
    const inserted = summary.inserted[0]!;
    expect(inserted.source).toBe("externally_observed");
    expect(inserted.externalRegistryId).toBe(
      "mcp-registry:io.github.example/agent:https://api.example-mcp-agent.com/mcp",
    );
    expect(inserted.endpointUrl).toBe("https://api.example-mcp-agent.com/mcp");
    expect(summary.rejected).toHaveLength(0);
    expect(summary.duplicatesSkipped).toHaveLength(0);
    expect(summary.errors).toHaveLength(0);
  });

  // --- Registration semantics -------------------------------------------

  it("inserts discovered agents unclaimed, unverified, and on pull monitoring", async () => {
    mockedFetch.mockResolvedValue([entry({})]);
    const summary = await importMcpRegistryAgents(db, { fetchLimit: 50 });
    const inserted = summary.inserted[0]!;

    expect(inserted.ownerId).toBeNull();
    expect(inserted.ownershipVerifiedAt).toBeNull();
    expect(inserted.monitoringMode).toBe("pull");
    expect(inserted.lifecycleStatus).toBe("active");
    expect(inserted.discoveredAt).not.toBeNull();
  });

  it("does not give a freshly discovered agent a positive trustDecision — trustDecision semantics unchanged", async () => {
    mockedFetch.mockResolvedValue([entry({})]);
    const summary = await importMcpRegistryAgents(db, { fetchLimit: 50 });
    const inserted = summary.inserted[0]!;

    const enriched = await toTrustEnrichedAgentJson(db, inserted);
    expect(enriched.reliabilityScore).toBeNull();
    expect(enriched.trustDecision.confidence).toBe("insufficient_data");
    expect(enriched.trustDecision.recommended).toBe(false);
  });

  // --- Candidate extraction ----------------------------------------------

  it("extracts only explicit streamable-http remote URLs, never inventing one", async () => {
    mockedFetch.mockResolvedValue([
      entry({
        name: "io.github.example/multi",
        remotes: [
          { type: "stdio" }, // no url at all — must never be invented
          { type: "streamable-http", url: "https://a.example.com/mcp" },
          { type: "sse", url: "https://b.example.com/sse" }, // not a supported transport here
          { type: "streamable-http", url: "https://c.example.com/mcp" },
        ],
      }),
    ]);
    const summary = await importMcpRegistryAgents(db, { fetchLimit: 50, insertLimit: 10 });

    expect(summary.sourceCandidates).toBe(2); // only the two streamable-http remotes
    expect(summary.inserted).toHaveLength(2);
    const urls = summary.inserted.map((a) => a.endpointUrl).sort();
    expect(urls).toEqual(["https://a.example.com/mcp", "https://c.example.com/mcp"]);
  });

  it("rejects a server with no usable remote endpoint (stdio only)", async () => {
    mockedFetch.mockResolvedValue([
      entry({ name: "io.github.example/stdio-only", remotes: [{ type: "stdio" }] }),
    ]);
    const summary = await importMcpRegistryAgents(db, { fetchLimit: 50 });
    expect(summary.inserted).toHaveLength(0);
    expect(summary.rejected).toEqual([
      expect.objectContaining({ reason: "no_remote_endpoint" }),
    ]);
  });

  it("filters out a server whose registry status isn't 'active'", async () => {
    mockedFetch.mockResolvedValue([entry({ status: "deprecated" })]);
    const summary = await importMcpRegistryAgents(db, { fetchLimit: 50 });
    expect(summary.inserted).toHaveLength(0);
    expect(summary.rejected).toEqual([
      expect.objectContaining({ reason: "not_active", detail: "deprecated" }),
    ]);
  });

  // --- URL safety ----------------------------------------------------------

  it("rejects a private/local URL (SSRF)", async () => {
    mockedFetch.mockResolvedValue([
      entry({
        name: "io.github.example/ssrf-1",
        remotes: [{ type: "streamable-http", url: "https://169.254.169.254/latest/meta-data" }],
      }),
      entry({
        name: "io.github.example/ssrf-2",
        remotes: [{ type: "streamable-http", url: "https://localhost:8080/mcp" }],
      }),
    ]);
    const summary = await importMcpRegistryAgents(db, { fetchLimit: 50 });
    expect(summary.inserted).toHaveLength(0);
    expect(summary.rejected).toHaveLength(2);
    for (const skipped of summary.rejected) {
      expect(skipped.reason).toBe("validation_failed");
    }
  });

  it("rejects a URL containing embedded credentials", async () => {
    mockedFetch.mockResolvedValue([
      entry({
        remotes: [{ type: "streamable-http", url: "https://user:pass@api.example.com/mcp" }],
      }),
    ]);
    const summary = await importMcpRegistryAgents(db, { fetchLimit: 50 });
    expect(summary.inserted).toHaveLength(0);
    expect(summary.rejected[0]?.reason).toBe("validation_failed");
  });

  it("rejects a non-http(s) scheme", async () => {
    mockedFetch.mockResolvedValue([
      entry({ remotes: [{ type: "streamable-http", url: "ftp://api.example.com/mcp" }] }),
    ]);
    const summary = await importMcpRegistryAgents(db, { fetchLimit: 50 });
    expect(summary.inserted).toHaveLength(0);
    expect(summary.rejected[0]?.reason).toBe("validation_failed");
  });

  it("rejects a non-https (plain http) endpoint the same way registration would", async () => {
    mockedFetch.mockResolvedValue([
      entry({ remotes: [{ type: "streamable-http", url: "http://api.example.com/mcp" }] }),
    ]);
    const summary = await importMcpRegistryAgents(db, { fetchLimit: 50 });
    expect(summary.inserted).toHaveLength(0);
    expect(summary.rejected[0]?.reason).toBe("validation_failed");
  });

  it("rejects a malformed URL", async () => {
    mockedFetch.mockResolvedValue([
      entry({ remotes: [{ type: "streamable-http", url: "not-a-url" }] }),
    ]);
    const summary = await importMcpRegistryAgents(db, { fetchLimit: 50 });
    expect(summary.inserted).toHaveLength(0);
    expect(summary.rejected[0]?.reason).toBe("validation_failed");
  });

  // --- Deduplication ---------------------------------------------------

  it("normalizes and skips a candidate whose endpoint duplicates an existing owner-registered agent", async () => {
    const ownerInput: AgentInput = {
      name: "Existing Owner Agent",
      endpointUrl: "https://api.example-mcp-agent.com/mcp",
      capabilities: [],
      authType: "none",
    };
    await createAgent(db, ownerA, ownerInput);

    mockedFetch.mockResolvedValue([entry({})]);
    const summary = await importMcpRegistryAgents(db, { fetchLimit: 50 });

    expect(summary.inserted).toHaveLength(0);
    expect(summary.duplicatesSkipped).toEqual([
      expect.objectContaining({ reason: "duplicate_endpoint" }),
    ]);
  });

  it("skips re-importing the same server+URL on a re-run via duplicate_registry_id", async () => {
    mockedFetch.mockResolvedValue([entry({})]);
    await importMcpRegistryAgents(db, { fetchLimit: 50 });

    mockedFetch.mockResolvedValue([entry({})]);
    const secondRun = await importMcpRegistryAgents(db, { fetchLimit: 50 });

    expect(secondRun.inserted).toHaveLength(0);
    expect(secondRun.duplicatesSkipped).toEqual([
      expect.objectContaining({ reason: "duplicate_registry_id" }),
    ]);
  });

  it("never inserts two candidates in the same batch that share an endpoint URL", async () => {
    mockedFetch.mockResolvedValue([
      entry({ name: "io.github.example/dup-a" }),
      entry({ name: "io.github.example/dup-b" }), // same default remote URL
    ]);
    const summary = await importMcpRegistryAgents(db, { fetchLimit: 50 });
    expect(summary.inserted).toHaveLength(1);
    expect(summary.duplicatesSkipped).toEqual([
      expect.objectContaining({ reason: "duplicate_endpoint" }),
    ]);
  });

  // --- Conservative daily cap -------------------------------------------

  it("never inserts more than MCP_DISCOVERY_DAILY_INSERT_CAP agents in one run", async () => {
    expect(MCP_DISCOVERY_DAILY_INSERT_CAP).toBe(10);

    const many: McpRegistryEntry[] = Array.from({ length: 15 }, (_, i) =>
      entry({
        name: `io.github.example/agent-${i}`,
        remotes: [{ type: "streamable-http", url: `https://agent-${i}.example.com/mcp` }],
      }),
    );
    mockedFetch.mockResolvedValue(many);

    const summary = await importMcpRegistryAgents(db, { fetchLimit: 50 });

    expect(summary.inserted).toHaveLength(10);
    expect(summary.cappedBeforeInsert).toHaveLength(5);
    for (const capped of summary.cappedBeforeInsert) {
      expect(capped.reason).toBe("insert_cap_reached");
    }
  });

  it("clamps an insertLimit above the cap down to MCP_DISCOVERY_DAILY_INSERT_CAP", async () => {
    const many: McpRegistryEntry[] = Array.from({ length: 12 }, (_, i) =>
      entry({
        name: `io.github.example/clamp-${i}`,
        remotes: [{ type: "streamable-http", url: `https://clamp-${i}.example.com/mcp` }],
      }),
    );
    mockedFetch.mockResolvedValue(many);

    const summary = await importMcpRegistryAgents(db, { fetchLimit: 50, insertLimit: 999 });
    expect(summary.inserted).toHaveLength(10);
  });

  // --- Resilience --------------------------------------------------------

  it("does not abort the batch when one candidate fails unexpectedly during insert", async () => {
    mockedFetch.mockResolvedValue([
      entry({
        name: "io.github.example/will-fail",
        remotes: [{ type: "streamable-http", url: "https://will-fail.example.com/mcp" }],
      }),
      entry({
        name: "io.github.example/will-succeed",
        remotes: [{ type: "streamable-http", url: "https://will-succeed.example.com/mcp" }],
      }),
    ]);

    const actual = await vi.importActual<
      typeof import("@/lib/db/queries/public-agent-observation")
    >("@/lib/db/queries/public-agent-observation");
    mockedInsert
      .mockImplementationOnce(() => {
        throw new Error("simulated transient failure");
      })
      .mockImplementationOnce(actual.insertExternallyObservedAgent);

    const summary = await importMcpRegistryAgents(db, { fetchLimit: 50 });

    expect(summary.errors).toEqual([
      expect.objectContaining({ reason: "insert_failed", name: "Example Agent" }),
    ]);
    expect(summary.inserted).toHaveLength(1);
    expect(summary.inserted[0]!.endpointUrl).toBe("https://will-succeed.example.com/mcp");
  });

  it("fails closed and inserts nothing when the whole registry fetch fails", async () => {
    mockedFetch.mockRejectedValue(new McpRegistryFetchError("Couldn't reach the MCP Registry."));

    await expect(
      importMcpRegistryAgents(db, { fetchLimit: 50 }),
    ).rejects.toBeInstanceOf(McpRegistryFetchError);

    const signatures = await getExistingAgentSignatures(db);
    expect(signatures.externalRegistryIds.size).toBe(0);
  });
});
