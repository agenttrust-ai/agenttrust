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
  MCP_DISCOVERY_RUN_ACTION,
} from "./import-mcp-registry-agents";

const mockedFetch = vi.mocked(fetchMcpRegistryServers);
const mockedInsert = vi.mocked(insertExternallyObservedAgent);

// One registry page and nothing after it — the whole registry, as far as a
// test that predates pagination is concerned.
function mockResolvedPage(entries: McpRegistryEntry[]): void {
  mockedFetch.mockResolvedValue({ entries, nextCursor: null });
}

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
    mockResolvedPage([entry({})]);

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
    mockResolvedPage([entry({})]);
    const summary = await importMcpRegistryAgents(db, { fetchLimit: 50 });
    const inserted = summary.inserted[0]!;

    expect(inserted.ownerId).toBeNull();
    expect(inserted.ownershipVerifiedAt).toBeNull();
    expect(inserted.monitoringMode).toBe("pull");
    expect(inserted.lifecycleStatus).toBe("active");
    expect(inserted.discoveredAt).not.toBeNull();
  });

  it("does not give a freshly discovered agent a positive trustDecision — trustDecision semantics unchanged", async () => {
    mockResolvedPage([entry({})]);
    const summary = await importMcpRegistryAgents(db, { fetchLimit: 50 });
    const inserted = summary.inserted[0]!;

    const enriched = await toTrustEnrichedAgentJson(db, inserted);
    expect(enriched.reliabilityScore).toBeNull();
    expect(enriched.trustDecision.confidence).toBe("insufficient_data");
    expect(enriched.trustDecision.recommended).toBe(false);
  });

  // --- Candidate extraction ----------------------------------------------

  it("extracts only explicit streamable-http remote URLs, never inventing one", async () => {
    mockResolvedPage([
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
    mockResolvedPage([
      entry({ name: "io.github.example/stdio-only", remotes: [{ type: "stdio" }] }),
    ]);
    const summary = await importMcpRegistryAgents(db, { fetchLimit: 50 });
    expect(summary.inserted).toHaveLength(0);
    expect(summary.rejected).toEqual([
      expect.objectContaining({ reason: "no_remote_endpoint" }),
    ]);
  });

  it("filters out a server whose registry status isn't 'active'", async () => {
    mockResolvedPage([entry({ status: "deprecated" })]);
    const summary = await importMcpRegistryAgents(db, { fetchLimit: 50 });
    expect(summary.inserted).toHaveLength(0);
    expect(summary.rejected).toEqual([
      expect.objectContaining({ reason: "not_active", detail: "deprecated" }),
    ]);
  });

  // --- URL safety ----------------------------------------------------------

  it("rejects a private/local URL (SSRF)", async () => {
    mockResolvedPage([
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
    mockResolvedPage([
      entry({
        remotes: [{ type: "streamable-http", url: "https://user:pass@api.example.com/mcp" }],
      }),
    ]);
    const summary = await importMcpRegistryAgents(db, { fetchLimit: 50 });
    expect(summary.inserted).toHaveLength(0);
    expect(summary.rejected[0]?.reason).toBe("validation_failed");
  });

  it("rejects a non-http(s) scheme", async () => {
    mockResolvedPage([
      entry({ remotes: [{ type: "streamable-http", url: "ftp://api.example.com/mcp" }] }),
    ]);
    const summary = await importMcpRegistryAgents(db, { fetchLimit: 50 });
    expect(summary.inserted).toHaveLength(0);
    expect(summary.rejected[0]?.reason).toBe("validation_failed");
  });

  it("rejects a non-https (plain http) endpoint the same way registration would", async () => {
    mockResolvedPage([
      entry({ remotes: [{ type: "streamable-http", url: "http://api.example.com/mcp" }] }),
    ]);
    const summary = await importMcpRegistryAgents(db, { fetchLimit: 50 });
    expect(summary.inserted).toHaveLength(0);
    expect(summary.rejected[0]?.reason).toBe("validation_failed");
  });

  it("rejects a malformed URL", async () => {
    mockResolvedPage([
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

    mockResolvedPage([entry({})]);
    const summary = await importMcpRegistryAgents(db, { fetchLimit: 50 });

    expect(summary.inserted).toHaveLength(0);
    expect(summary.duplicatesSkipped).toEqual([
      expect.objectContaining({ reason: "duplicate_endpoint" }),
    ]);
  });

  it("skips re-importing the same server+URL on a re-run via duplicate_registry_id", async () => {
    mockResolvedPage([entry({})]);
    await importMcpRegistryAgents(db, { fetchLimit: 50 });

    mockResolvedPage([entry({})]);
    const secondRun = await importMcpRegistryAgents(db, { fetchLimit: 50 });

    expect(secondRun.inserted).toHaveLength(0);
    expect(secondRun.duplicatesSkipped).toEqual([
      expect.objectContaining({ reason: "duplicate_registry_id" }),
    ]);
  });

  it("never inserts two candidates in the same batch that share an endpoint URL", async () => {
    mockResolvedPage([
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
    mockResolvedPage(many);

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
    mockResolvedPage(many);

    const summary = await importMcpRegistryAgents(db, { fetchLimit: 50, insertLimit: 999 });
    expect(summary.inserted).toHaveLength(10);
  });

  // --- Resilience --------------------------------------------------------

  it("does not abort the batch when one candidate fails unexpectedly during insert", async () => {
    mockResolvedPage([
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

describe("importMcpRegistryAgents — pagination and resume", () => {
  function newAgent(i: number, name = `io.github.example/page-${i}`): McpRegistryEntry {
    return entry({
      name,
      title: `Page Agent ${i}`,
      remotes: [{ type: "streamable-http", url: `https://page-agent-${i}.example.com/mcp` }],
    });
  }
  const stdioOnly = (name: string) => entry({ name, remotes: [{ type: "stdio" }] });

  async function seedResumeCursor(resumeCursor: unknown): Promise<void> {
    await client.query(
      `insert into public.audit_log (action, metadata) values ($1, $2::jsonb)`,
      [MCP_DISCOVERY_RUN_ACTION, JSON.stringify({ resumeCursor })],
    );
  }

  async function runRecords(): Promise<Record<string, unknown>[]> {
    const rows = await client.query<{ metadata: Record<string, unknown> }>(
      `select metadata from public.audit_log where action = $1 order by created_at`,
      [MCP_DISCOVERY_RUN_ACTION],
    );
    return rows.rows.map((r) => r.metadata);
  }

  const cursorsRequested = () => mockedFetch.mock.calls.map((call) => call[1]);
  const tomorrow = () => new Date(Date.now() + 24 * 60 * 60 * 1000);

  it("starts from the first page when nothing has run yet, and crosses a page with nothing new", async () => {
    mockedFetch
      .mockResolvedValueOnce({ entries: [stdioOnly("io.github.example/stdio")], nextCursor: "c2" })
      .mockResolvedValueOnce({ entries: [newAgent(1)], nextCursor: null });

    const summary = await importMcpRegistryAgents(db, { fetchLimit: 50 });

    expect(cursorsRequested()).toEqual([undefined, "c2"]);
    expect(summary.pagesRead).toBe(2);
    expect(summary.inserted).toHaveLength(1);
    expect(summary.stoppedReason).toBe("end_of_registry");
    expect(summary.progressSaved).toBe(true);
  });

  it("resumes from the cursor the previous run recorded instead of page 1", async () => {
    await seedResumeCursor("c7");
    mockedFetch.mockResolvedValueOnce({ entries: [newAgent(7)], nextCursor: "c8" });
    mockedFetch.mockResolvedValueOnce({ entries: [], nextCursor: null });

    await importMcpRegistryAgents(db, { fetchLimit: 50 });

    expect(cursorsRequested()[0]).toBe("c7");
  });

  it("carries progress across runs (restart/redeploy safe — state lives in the database)", async () => {
    mockedFetch
      .mockResolvedValueOnce({ entries: [stdioOnly("io.github.example/s1")], nextCursor: "c2" })
      .mockResolvedValueOnce({ entries: [stdioOnly("io.github.example/s2")], nextCursor: "c3" });
    const first = await importMcpRegistryAgents(db, { fetchLimit: 50, maxPages: 2 });
    expect(first.stoppedReason).toBe("page_budget");

    mockedFetch.mockReset();
    mockedFetch.mockResolvedValueOnce({ entries: [newAgent(3)], nextCursor: null });
    const second = await importMcpRegistryAgents(db, { fetchLimit: 50, maxPages: 2 });

    expect(cursorsRequested()).toEqual(["c3"]);
    expect(second.inserted).toHaveLength(1);
  });

  it("never lets a run of already-known pages block progress", async () => {
    const known: AgentInput = {
      name: "Known",
      endpointUrl: "https://page-agent-1.example.com/mcp",
      capabilities: [],
      authType: "none",
    };
    await createAgent(db, ownerA, known);
    mockedFetch
      .mockResolvedValueOnce({ entries: [newAgent(1)], nextCursor: "c2" }) // duplicate endpoint
      .mockResolvedValueOnce({ entries: [stdioOnly("io.github.example/x")], nextCursor: "c3" })
      .mockResolvedValueOnce({ entries: [newAgent(3)], nextCursor: null });

    const summary = await importMcpRegistryAgents(db, { fetchLimit: 50 });

    expect(summary.duplicatesSkipped).toHaveLength(1);
    expect(summary.inserted.map((a) => a.endpointUrl)).toEqual([
      "https://page-agent-3.example.com/mcp",
    ]);
  });

  it("stops at the page budget and resumes after the last page read", async () => {
    mockedFetch
      .mockResolvedValueOnce({ entries: [stdioOnly("io.github.example/a")], nextCursor: "c2" })
      .mockResolvedValueOnce({ entries: [stdioOnly("io.github.example/b")], nextCursor: "c3" });

    const summary = await importMcpRegistryAgents(db, { fetchLimit: 50, maxPages: 2 });

    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(summary.stoppedReason).toBe("page_budget");
    expect((await runRecords()).at(-1)?.resumeCursor).toBe("c3");
  });

  it("wraps to the first page only after reaching the end of the registry", async () => {
    await seedResumeCursor("c9");
    mockedFetch.mockResolvedValueOnce({ entries: [], nextCursor: null });

    const summary = await importMcpRegistryAgents(db, { fetchLimit: 50 });

    expect(summary.stoppedReason).toBe("end_of_registry");
    expect((await runRecords()).at(-1)?.resumeCursor).toBeNull();

    mockedFetch.mockReset();
    mockedFetch.mockResolvedValueOnce({ entries: [], nextCursor: null });
    await importMcpRegistryAgents(db, { fetchLimit: 50 });
    expect(cursorsRequested()).toEqual([undefined]);
  });

  it("re-reads a page when the cap was reached part-way through it, so none of it is skipped", async () => {
    await seedResumeCursor("cA");
    const pageA = { entries: [newAgent(1), newAgent(2), newAgent(3)], nextCursor: "cB" };
    mockedFetch.mockResolvedValueOnce(pageA);

    const first = await importMcpRegistryAgents(db, { fetchLimit: 50, insertLimit: 2 });
    expect(first.inserted).toHaveLength(2);
    expect(first.stoppedReason).toBe("insert_cap_reached");
    expect((await runRecords()).at(-1)?.resumeCursor).toBe("cA");

    // Next day: the same page again — the two already inserted are duplicates, the third is new.
    mockedFetch.mockReset();
    mockedFetch.mockResolvedValueOnce(pageA);
    mockedFetch.mockResolvedValueOnce({ entries: [], nextCursor: null });
    const second = await importMcpRegistryAgents(db, {
      fetchLimit: 50,
      insertLimit: 2,
      now: tomorrow,
    });
    expect(cursorsRequested()[0]).toBe("cA");
    expect(second.duplicatesSkipped).toHaveLength(2);
    expect(second.inserted.map((a) => a.endpointUrl)).toEqual([
      "https://page-agent-3.example.com/mcp",
    ]);
  });

  it("moves past a page when the cap is reached exactly on its last candidate", async () => {
    mockedFetch.mockResolvedValueOnce({ entries: [newAgent(1), newAgent(2)], nextCursor: "cB" });

    const summary = await importMcpRegistryAgents(db, { fetchLimit: 50, insertLimit: 2 });

    expect(summary.stoppedReason).toBe("insert_cap_reached");
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect((await runRecords()).at(-1)?.resumeCursor).toBe("cB");
  });

  it("holds the daily cap across runs on the same day (duplicate or repeated invocation)", async () => {
    const many = Array.from({ length: 12 }, (_, i) => newAgent(i));
    mockedFetch.mockResolvedValueOnce({ entries: many, nextCursor: null });
    const first = await importMcpRegistryAgents(db, { fetchLimit: 50 });
    expect(first.inserted).toHaveLength(MCP_DISCOVERY_DAILY_INSERT_CAP);

    mockedFetch.mockReset();
    const second = await importMcpRegistryAgents(db, { fetchLimit: 50 });

    expect(second.stoppedReason).toBe("daily_cap_already_reached");
    expect(second.inserted).toHaveLength(0);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("on a registry failure mid-run keeps what was inserted, records progress, retries the failed page next time, and still fails the run", async () => {
    await seedResumeCursor("c1");
    mockedFetch
      .mockResolvedValueOnce({ entries: [newAgent(1)], nextCursor: "c2" })
      .mockRejectedValueOnce(new McpRegistryFetchError("MCP Registry returned HTTP 503.", undefined, 503));

    await expect(importMcpRegistryAgents(db, { fetchLimit: 50 })).rejects.toBeInstanceOf(
      McpRegistryFetchError,
    );

    const last = (await runRecords()).at(-1);
    expect(last?.stoppedReason).toBe("registry_error");
    expect(last?.resumeCursor).toBe("c2");
    expect(last?.inserted).toBe(1);
    const count = await client.query<{ n: number }>(
      `select count(*)::int as n from public.agents where external_registry_id like 'mcp-registry:%'`,
    );
    expect(count.rows[0].n).toBe(1);
  });

  it("starts over from the first page once if the registry rejects the stored cursor", async () => {
    await seedResumeCursor("stale-cursor");
    mockedFetch
      .mockRejectedValueOnce(new McpRegistryFetchError("MCP Registry returned HTTP 422.", undefined, 422))
      .mockResolvedValueOnce({ entries: [newAgent(1)], nextCursor: null });

    const summary = await importMcpRegistryAgents(db, { fetchLimit: 50 });

    expect(cursorsRequested()).toEqual(["stale-cursor", undefined]);
    expect(summary.inserted).toHaveLength(1);
    expect((await runRecords()).at(-1)?.cursorReset).toBe(true);
  });

  it("ignores an unusable stored cursor and starts from the first page", async () => {
    await seedResumeCursor(12345);
    mockedFetch.mockResolvedValueOnce({ entries: [], nextCursor: null });
    await importMcpRegistryAgents(db, { fetchLimit: 50 });
    expect(cursorsRequested()).toEqual([undefined]);
  });

  it("records counts and cursors only — never candidate URLs or names", async () => {
    mockedFetch.mockResolvedValueOnce({ entries: [newAgent(1)], nextCursor: null });
    await importMcpRegistryAgents(db, { fetchLimit: 50 });

    const record = (await runRecords()).at(-1)!;
    const raw = JSON.stringify(record);
    expect(raw).not.toContain("page-agent-1.example.com");
    expect(raw).not.toContain("Page Agent 1");
    expect(record).toMatchObject({ inserted: 1, pagesRead: 1, stoppedReason: "end_of_registry" });
  });
});
