import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, seedUser } from "@/lib/db/test-harness";
import type { AppDatabase } from "@/lib/db/rls";
import { createAgent } from "@/lib/db/queries/agents";
import type { McpRegistryEntry, McpRegistryPage } from "@/lib/discovery/mcp-registry";
import { endpointKey } from "@/lib/telemetry/trust-check-events";
import {
  OBSERVATION_MESSAGES,
  countObservationRequestsByStatus,
  isDemandCoverageEnabled,
  observationCandidate,
  observeUnknownEndpoint,
  processObservationQueue,
  recordObservationDemand,
  registrySearchTerm,
} from "./observation";

const KEY = "k".repeat(40);
const owner = "44444444-4444-4444-4444-444444444444";

let client: PGlite;
let db: AppDatabase;

beforeEach(async () => {
  const harness = await createTestDb();
  client = harness.client;
  db = harness.db;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await client.close();
});

function enableCoverage() {
  vi.stubEnv("TELEMETRY_HASH_KEY", KEY);
  vi.stubEnv("DEMAND_COVERAGE_ENABLED", "true");
}

async function queue(url: string, options?: Parameters<typeof recordObservationDemand>[2]) {
  const candidate = observationCandidate(url, KEY);
  if (!candidate) throw new Error(`not a candidate: ${url}`);
  return recordObservationDemand(db, candidate, options);
}

async function rows() {
  const { rows } = await client.query<{ endpoint_key: string; endpoint_host: string; status: string; request_count: number; agent_id: string | null }>(
    "select endpoint_key, endpoint_host, status, request_count, agent_id from public.observation_requests order by first_requested_at",
  );
  return rows;
}

function registryEntry(name: string, url: string, status = "active"): McpRegistryEntry {
  return {
    server: { name, title: `${name} server`, description: "From the registry.", version: "1.0.0", remotes: [{ type: "streamable-http", url }] },
    status,
  };
}

/** A registry stub that records every request and answers from a fixed catalogue. */
function registryStub(catalogue: McpRegistryEntry[]) {
  const calls: { limit: number; cursor?: string; search?: string }[] = [];
  const fetchRegistry = async (limit: number, cursor?: string, search?: string): Promise<McpRegistryPage> => {
    calls.push({ limit, cursor, search });
    return { entries: catalogue.filter((entry) => !search || entry.server.name.includes(search)), nextCursor: null };
  };
  return { calls, fetchRegistry };
}

describe("eligibility: which URLs may ever be queued", () => {
  it.each([
    ["http://mcp.acme.dev/mcp", "plain http"],
    ["https://user:pass@mcp.acme.dev/mcp", "credentials in the URL"],
    ["https://localhost/mcp", "localhost"],
    ["https://app.localhost/mcp", "a .localhost name"],
    ["https://127.0.0.1/mcp", "IPv4 loopback"],
    ["https://10.0.0.5/mcp", "private IPv4"],
    ["https://192.168.1.10/mcp", "private IPv4"],
    ["https://169.254.169.254/latest/meta-data", "cloud metadata (link-local)"],
    ["https://[::1]/mcp", "IPv6 loopback"],
    ["https://[fd00::1]/mcp", "IPv6 unique-local"],
    ["https://8.8.8.8/mcp", "a public IP literal (no hostname to look up)"],
    ["https://metadata.internal/mcp", "an internal suffix"],
    ["https://intranet/mcp", "a dot-less host"],
    ["https://mcp.example.com/mcp", "a reserved example domain"],
    ["not a url", "not a URL"],
    ["ftp://mcp.acme.dev/mcp", "another scheme"],
  ])("never queues %s (%s)", (url) => {
    expect(observationCandidate(url, KEY)).toBeNull();
  });

  it("queues a public https endpoint, keeping only its hostname and keyed hash", () => {
    const candidate = observationCandidate("https://MCP.Acme.dev/mcp/?token=secret#x", KEY);
    expect(candidate).toEqual({
      endpointHost: "mcp.acme.dev",
      endpointKey: endpointKey("https://mcp.acme.dev/mcp", KEY),
    });
    expect(JSON.stringify(candidate)).not.toContain("secret");
  });

  it("needs the telemetry key — without it nothing can be queued", () => {
    expect(observationCandidate("https://mcp.acme.dev/mcp", null)).toBeNull();
  });

  it("is off unless DEMAND_COVERAGE_ENABLED is 'true' and the telemetry key is set", () => {
    expect(isDemandCoverageEnabled()).toBe(false);
    vi.stubEnv("DEMAND_COVERAGE_ENABLED", "true");
    expect(isDemandCoverageEnabled()).toBe(false);
    vi.stubEnv("TELEMETRY_HASH_KEY", KEY);
    expect(isDemandCoverageEnabled()).toBe(true);
  });
});

describe("recording demand", () => {
  it("de-duplicates the same endpoint across query strings, trailing slashes and host casing", async () => {
    expect(await queue("https://mcp.acme.dev/mcp")).toBe("pending");
    expect(await queue("https://MCP.ACME.dev/mcp/")).toBe("pending");
    expect(await queue("https://mcp.acme.dev/mcp?api_key=abc")).toBe("pending");
    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ endpoint_host: "mcp.acme.dev", status: "pending", request_count: 3 });
  });

  it("never stores the URL a caller sent", async () => {
    await queue("https://mcp.acme.dev/secret-path-token/mcp?key=secret");
    const { rows: raw } = await client.query("select * from public.observation_requests");
    expect(JSON.stringify(raw)).not.toMatch(/secret|\/mcp/);
  });

  it("stops recording new endpoints at the daily cap, but still counts known ones", async () => {
    expect(await queue("https://a.acme.dev/mcp", { dailyNewRequests: 2 })).toBe("pending");
    expect(await queue("https://b.acme.dev/mcp", { dailyNewRequests: 2 })).toBe("pending");
    expect(await queue("https://c.acme.dev/mcp", { dailyNewRequests: 2 })).toBeNull();
    expect(await queue("https://a.acme.dev/mcp", { dailyNewRequests: 2 })).toBe("pending");
    expect(await rows()).toHaveLength(2);
  });

  it("bounds the queue: no new pending request once it holds the maximum", async () => {
    expect(await queue("https://a.acme.dev/mcp", { maxPending: 1 })).toBe("pending");
    expect(await queue("https://b.acme.dev/mcp", { maxPending: 1 })).toBeNull();
    expect(await countObservationRequestsByStatus(db)).toEqual({ pending: 1 });
  });

  it("looks a not_in_registry endpoint up again once it has been resolved for 30 days", async () => {
    await queue("https://gone.acme.dev/mcp");
    await client.query(
      "update public.observation_requests set status = 'not_in_registry', resolved_at = now() - interval '31 days'",
    );
    expect(await queue("https://gone.acme.dev/mcp")).toBe("pending");
    await client.query(
      "update public.observation_requests set status = 'not_in_registry', resolved_at = now() - interval '1 day'",
    );
    expect(await queue("https://gone.acme.dev/mcp")).toBe("not_in_registry");
  });
});

describe("observeUnknownEndpoint (the trust check's hook)", () => {
  it("returns null and records nothing while the feature is off", async () => {
    vi.stubEnv("TELEMETRY_HASH_KEY", KEY);
    expect(await observeUnknownEndpoint(db, "https://mcp.acme.dev/mcp")).toBeNull();
    expect(await rows()).toHaveLength(0);
  });

  it("returns the pending status and its message when enabled", async () => {
    enableCoverage();
    expect(await observeUnknownEndpoint(db, "https://mcp.acme.dev/mcp")).toEqual({
      status: "pending",
      message: OBSERVATION_MESSAGES.pending,
    });
  });

  it("returns null for an ineligible URL even when enabled", async () => {
    enableCoverage();
    expect(await observeUnknownEndpoint(db, "https://10.0.0.1/mcp")).toBeNull();
    expect(await rows()).toHaveLength(0);
  });

  it("never throws: a database failure just means no observation", async () => {
    enableCoverage();
    await client.close();
    expect(await observeUnknownEndpoint(db, "https://mcp.acme.dev/mcp")).toBeNull();
    const fresh = await createTestDb();
    client = fresh.client;
    db = fresh.db;
  });
});

describe("registrySearchTerm", () => {
  it.each([
    ["mcp.acme.dev", "dev.acme"],
    ["api.mcp.acme.dev", "dev.acme"],
    ["acme.dev", "dev.acme"],
    ["mcp.acme.co.uk", "uk.co.acme"],
    ["mcp.acme.com.au", "au.com.acme"],
  ])("%s -> %s", (host, term) => {
    expect(registrySearchTerm(host)).toBe(term);
  });
});

describe("processing the queue (daily discovery run)", () => {
  it("observes an endpoint a registry server publishes, through the same insert discovery uses", async () => {
    await queue("https://mcp.acme.dev/mcp?token=caller-secret");
    const { calls, fetchRegistry } = registryStub([registryEntry("dev.acme/tools", "https://mcp.acme.dev/mcp")]);

    const summary = await processObservationQueue(db, { key: KEY, fetchRegistry });

    expect(summary).toMatchObject({ considered: 1, lookups: 1, observing: 1, notInRegistry: 0 });
    expect(calls).toEqual([{ limit: 100, cursor: undefined, search: "dev.acme" }]);
    const [request] = await rows();
    expect(request.status).toBe("observing");
    const { rows: [agent] } = await client.query<Record<string, unknown>>(
      "select source, owner_id, ownership_verified_at, lifecycle_status, visibility, monitoring_mode, endpoint_url, external_registry_id from public.agents where id = $1",
      [request.agent_id],
    );
    // The registry's published URL — never the caller's, and nothing invented.
    expect(agent).toMatchObject({
      source: "externally_observed",
      owner_id: null,
      ownership_verified_at: null,
      lifecycle_status: "active",
      visibility: "public",
      monitoring_mode: "pull",
      endpoint_url: "https://mcp.acme.dev/mcp",
      external_registry_id: "mcp-registry:dev.acme/tools:https://mcp.acme.dev/mcp",
    });
    const { rows: scores } = await client.query("select 1 from public.reliability_scores where agent_id = $1", [request.agent_id]);
    expect(scores).toHaveLength(0);
  });

  it("resolves not_in_registry when no active registry server publishes the URL", async () => {
    await queue("https://mcp.acme.dev/mcp");
    await queue("https://other.acme.dev/mcp");
    const { fetchRegistry } = registryStub([
      registryEntry("dev.acme/tools", "https://elsewhere.acme.dev/mcp"),
      registryEntry("dev.acme/legacy", "https://other.acme.dev/mcp", "deprecated"),
    ]);

    const summary = await processObservationQueue(db, { key: KEY, fetchRegistry });

    expect(summary).toMatchObject({ lookups: 1, observing: 0, notInRegistry: 2 });
    expect(await countObservationRequestsByStatus(db)).toEqual({ not_in_registry: 2 });
    const { rows: imported } = await client.query("select 1 from public.agents");
    expect(imported).toHaveLength(0);
  });

  it("only ever contacts the registry, and never more than one search per host namespace", async () => {
    await queue("https://a.acme.dev/mcp");
    await queue("https://b.acme.dev/mcp");
    await queue("https://mcp.other.io/mcp");
    const globalFetch = vi.spyOn(globalThis, "fetch");
    const { calls, fetchRegistry } = registryStub([]);

    await processObservationQueue(db, { key: KEY, fetchRegistry });

    expect(calls.map((call) => call.search).sort()).toEqual(["dev.acme", "io.other"]);
    expect(globalFetch).not.toHaveBeenCalled();
    globalFetch.mockRestore();
  });

  it("caps registry searches per run and leaves the rest pending", async () => {
    await queue("https://mcp.one.dev/mcp");
    await queue("https://mcp.two.dev/mcp");
    await queue("https://mcp.three.dev/mcp");
    const { calls, fetchRegistry } = registryStub([]);

    await processObservationQueue(db, { key: KEY, fetchRegistry, maxLookups: 2 });

    expect(calls).toHaveLength(2);
    expect(await countObservationRequestsByStatus(db)).toEqual({ not_in_registry: 2, pending: 1 });
  });

  it("respects the shared daily discovery cap: a match beyond it stays pending", async () => {
    await queue("https://mcp.acme.dev/mcp");
    const { fetchRegistry } = registryStub([registryEntry("dev.acme/tools", "https://mcp.acme.dev/mcp")]);

    const summary = await processObservationQueue(db, { key: KEY, fetchRegistry, insertLimit: 0 });

    expect(summary).toMatchObject({ observing: 0, deferredByCap: 1 });
    expect(await countObservationRequestsByStatus(db)).toEqual({ pending: 1 });
  });

  it("links an endpoint AgentTrust already has instead of creating a duplicate agent", async () => {
    await seedUser(client, owner, "owner@acme.dev");
    const existing = await createAgent(db, owner, {
      name: "Acme Tools",
      endpointUrl: "https://mcp.acme.dev/mcp",
      capabilities: [],
      authType: "none",
    });
    await queue("https://mcp.acme.dev/mcp");
    const { fetchRegistry } = registryStub([registryEntry("dev.acme/tools", "https://mcp.acme.dev/mcp")]);

    const summary = await processObservationQueue(db, { key: KEY, fetchRegistry });

    expect(summary).toMatchObject({ linkedExisting: 1, observing: 0 });
    expect((await rows())[0]).toMatchObject({ status: "observing", agent_id: existing.id });
    const { rows: all } = await client.query("select 1 from public.agents");
    expect(all).toHaveLength(1);
  });

  it("rejects a registry URL that fails the SSRF/HTTPS validation owner registration uses", async () => {
    // Callers can't queue such a URL, but the registry's published URL is
    // validated again before it can become an agent: simulate a stored hash
    // that matches a registry entry whose URL carries credentials.
    const unsafeUrl = "https://user:pw@mcp.acme.dev/mcp";
    await client.query(
      "insert into public.observation_requests (endpoint_key, endpoint_host) values ($1, 'mcp.acme.dev')",
      [endpointKey(unsafeUrl, KEY)],
    );
    const { fetchRegistry } = registryStub([registryEntry("dev.acme/tools", unsafeUrl)]);

    const summary = await processObservationQueue(db, { key: KEY, fetchRegistry });

    expect(summary).toMatchObject({ observing: 0, notInRegistry: 1 });
    const { rows: all } = await client.query("select 1 from public.agents");
    expect(all).toHaveLength(0);
  });

  it("retries a failed registry lookup, then gives up after three attempts", async () => {
    await queue("https://mcp.acme.dev/mcp");
    const failing = async (): Promise<McpRegistryPage> => {
      throw new Error("registry down");
    };

    for (let i = 0; i < 2; i++) {
      await processObservationQueue(db, { key: KEY, fetchRegistry: failing });
      expect(await countObservationRequestsByStatus(db)).toEqual({ pending: 1 });
    }
    const summary = await processObservationQueue(db, { key: KEY, fetchRegistry: failing });
    expect(summary.lookupErrors).toBe(1);
    expect(await countObservationRequestsByStatus(db)).toEqual({ not_in_registry: 1 });
  });

  it("deletes requests nobody has asked about for 90 days", async () => {
    await queue("https://old.acme.dev/mcp");
    await client.query("update public.observation_requests set last_requested_at = now() - interval '91 days'");
    const summary = await processObservationQueue(db, { key: KEY, fetchRegistry: registryStub([]).fetchRegistry });
    expect(summary.expiredDeleted).toBe(1);
    expect(await rows()).toHaveLength(0);
  });

  it("does nothing without the telemetry key", async () => {
    await queue("https://mcp.acme.dev/mcp");
    const { calls, fetchRegistry } = registryStub([]);
    const summary = await processObservationQueue(db, { key: null, fetchRegistry });
    expect(summary.enabled).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("database access", () => {
  it("the browser roles can neither read nor write the queue", async () => {
    await queue("https://mcp.acme.dev/mcp");
    for (const role of ["anon", "authenticated"]) {
      await expect(
        client.transaction(async (tx) => {
          await tx.query(`set local role ${role}`);
          return tx.query("select * from public.observation_requests");
        }),
      ).rejects.toThrow(/permission denied/);
    }
  });
});
