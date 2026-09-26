import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, seedUser } from "@/lib/db/test-harness";
import type { AppDatabase } from "@/lib/db/rls";
import type { AgentInput } from "@/lib/validation/agent";
import { createAgent, listPublicAgents, normalizeEndpointUrlForLookup } from "./agents";
import { insertExternallyObservedAgent } from "./public-agent-observation";
import {
  reconcileEndpointUrlNormalized,
  setNormalizedEndpointIfUnchanged,
} from "./endpoint-url-normalized";

const userA = "11111111-1111-1111-1111-111111111111";
const userB = "22222222-2222-2222-2222-222222222222";

const baseInput: AgentInput = {
  name: "Backfill Bot",
  endpointUrl: "https://backfill.example.com/a2a/",
  capabilities: ["chat"],
  authType: "none",
};

const longUrl = `https://long.example.com/${"a".repeat(2100)}`;

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

type Row = { id: string; endpoint_url: string; endpoint_url_normalized: string | null; updated_at: Date };

async function allRows(): Promise<Row[]> {
  const { rows } = await client.query<Row>(
    `select id, endpoint_url, endpoint_url_normalized, updated_at from public.agents order by id`,
  );
  return rows;
}

/** Simulates rows that existed before migration 0008: column present but NULL. */
async function clearAllNormalized() {
  await client.query(`update public.agents set endpoint_url_normalized = null`);
}

/**
 * A mix of every kind of row the backfill must handle: owner-registered
 * (public/active, draft, unlisted, another owner's), externally observed,
 * and one whose endpoint can't be normalized at all.
 */
async function seedMixedAgents() {
  const active = await createAgent(db, userA, { ...baseInput, name: "Active", endpointUrl: "https://Active.example.com/a2a/" });
  await client.query(`update public.agents set lifecycle_status = 'active' where id = $1`, [active.id]);
  await createAgent(db, userA, { ...baseInput, name: "Draft", endpointUrl: "https://draft.example.com:443/a2a" });
  const unlisted = await createAgent(db, userB, { ...baseInput, name: "Unlisted", endpointUrl: "https://unlisted.example.com/x/?q=1" });
  await client.query(
    `update public.agents set lifecycle_status = 'active', visibility = 'unlisted' where id = $1`,
    [unlisted.id],
  );
  const observed = await insertExternallyObservedAgent(db, {
    name: "Observed",
    endpointUrl: "https://bücher.example/a2a/",
    capabilityTags: [],
    externalRegistryId: "registry-1",
  });
  const tooLong = await createAgent(db, userB, { ...baseInput, name: "Too Long", endpointUrl: longUrl });
  return { active, unlisted, observed, tooLong };
}

function expectAllInSync(rows: Row[]) {
  for (const row of rows) {
    expect(row.endpoint_url_normalized).toBe(normalizeEndpointUrlForLookup(row.endpoint_url));
  }
}

describe("reconcileEndpointUrlNormalized — backfill", () => {
  it("dry run reports what would change and writes nothing", async () => {
    await seedMixedAgents();
    await clearAllNormalized();
    const before = await allRows();

    const result = await reconcileEndpointUrlNormalized(db, { dryRun: true });

    expect(result).toEqual({
      dryRun: true,
      scanned: 5,
      // the unnormalizable row is NULL and should be NULL — already in sync
      alreadyInSync: 1,
      outOfSync: 4,
      updated: 0,
      skippedConcurrentChange: 0,
      unnormalizable: 1,
    });
    expect(await allRows()).toEqual(before);
  });

  it("applies to every row regardless of owner, visibility, lifecycle or source, using the one normalization function", async () => {
    await seedMixedAgents();
    await clearAllNormalized();

    const result = await reconcileEndpointUrlNormalized(db, { dryRun: false });

    expect(result).toMatchObject({ scanned: 5, outOfSync: 4, updated: 4, skippedConcurrentChange: 0, unnormalizable: 1 });
    const rows = await allRows();
    expectAllInSync(rows);
    expect(rows.map((r) => r.endpoint_url_normalized).sort()).toEqual(
      [
        "https://active.example.com/a2a",
        "https://draft.example.com/a2a",
        "https://unlisted.example.com/x?q=1",
        "https://xn--bcher-kva.example/a2a",
        null,
      ].sort(),
    );
  });

  it("is idempotent: a second run finds everything in sync and writes nothing", async () => {
    await seedMixedAgents();
    await clearAllNormalized();
    await reconcileEndpointUrlNormalized(db, { dryRun: false });
    const afterFirst = await allRows();

    const second = await reconcileEndpointUrlNormalized(db, { dryRun: false });

    expect(second).toMatchObject({ scanned: 5, alreadyInSync: 5, outOfSync: 0, updated: 0 });
    expect(await allRows()).toEqual(afterFirst);
  });

  it("walks every row across multiple batches", async () => {
    await seedMixedAgents();
    await clearAllNormalized();

    const result = await reconcileEndpointUrlNormalized(db, { dryRun: false, batchSize: 2 });

    expect(result).toMatchObject({ scanned: 5, updated: 4 });
    expectAllInSync(await allRows());
  });

  it("never touches updated_at (derived data, not an owner edit)", async () => {
    await seedMixedAgents();
    await clearAllNormalized();
    const before = new Map((await allRows()).map((r) => [r.id, r.updated_at.toISOString()]));

    await reconcileEndpointUrlNormalized(db, { dryRun: false });

    for (const row of await allRows()) {
      expect(row.updated_at.toISOString()).toBe(before.get(row.id));
    }
  });

  it("makes a not-yet-backfilled public agent findable by the endpoint lookup", async () => {
    const { active } = await seedMixedAgents();
    await clearAllNormalized();
    const query = "https://active.example.com/a2a";
    expect((await listPublicAgents(db, { limit: 5, endpointUrl: query })).agents).toEqual([]);

    await reconcileEndpointUrlNormalized(db, { dryRun: false });

    expect((await listPublicAgents(db, { limit: 5, endpointUrl: query })).agents.map((a) => a.id)).toEqual([
      active.id,
    ]);
  });
});

describe("reconcileEndpointUrlNormalized — reconcile", () => {
  it("fixes a stale value left by code that changed endpoint_url without the column (e.g. the pre-0008 deploy)", async () => {
    const { active } = await seedMixedAgents();
    await client.query(`update public.agents set endpoint_url = 'https://moved.example.com/new/' where id = $1`, [
      active.id,
    ]);

    const result = await reconcileEndpointUrlNormalized(db, { dryRun: false });

    expect(result).toMatchObject({ outOfSync: 1, updated: 1 });
    const row = (await allRows()).find((r) => r.id === active.id)!;
    expect(row.endpoint_url_normalized).toBe("https://moved.example.com/new");
    expect(
      (await listPublicAgents(db, { limit: 5, endpointUrl: "https://moved.example.com/new" })).agents.map((a) => a.id),
    ).toEqual([active.id]);
    expect((await listPublicAgents(db, { limit: 5, endpointUrl: "https://active.example.com/a2a" })).agents).toEqual([]);
  });

  it("fixes an arbitrary wrong stored value and clears one stored for an unnormalizable endpoint", async () => {
    const { active, tooLong } = await seedMixedAgents();
    await client.query(`update public.agents set endpoint_url_normalized = 'https://wrong.example.com/' where id = $1`, [active.id]);
    await client.query(`update public.agents set endpoint_url_normalized = 'https://wrong.example.com/' where id = $1`, [tooLong.id]);

    const result = await reconcileEndpointUrlNormalized(db, { dryRun: false });

    expect(result).toMatchObject({ outOfSync: 2, updated: 2 });
    expectAllInSync(await allRows());
  });
});

describe("setNormalizedEndpointIfUnchanged — race guard", () => {
  it("writes when endpoint_url is still the value the normalization was computed from", async () => {
    const agent = await createAgent(db, userA, baseInput);
    await clearAllNormalized();

    const wrote = await setNormalizedEndpointIfUnchanged(db, {
      id: agent.id,
      expectedEndpointUrl: baseInput.endpointUrl,
      normalized: normalizeEndpointUrlForLookup(baseInput.endpointUrl),
    });

    expect(wrote).toBe(true);
    expectAllInSync(await allRows());
  });

  it("writes nothing if endpoint_url changed after the backfill read it, and a later reconcile run syncs it", async () => {
    const agent = await createAgent(db, userA, baseInput);
    // What the backfill read...
    const readEndpoint = agent.endpointUrl;
    const readNormalized = normalizeEndpointUrlForLookup(readEndpoint);
    // ...then a concurrent edit by code that didn't maintain the column.
    await client.query(
      `update public.agents set endpoint_url = 'https://edited.example.com/a2a', endpoint_url_normalized = null where id = $1`,
      [agent.id],
    );

    const wrote = await setNormalizedEndpointIfUnchanged(db, {
      id: agent.id,
      expectedEndpointUrl: readEndpoint,
      normalized: readNormalized,
    });

    expect(wrote).toBe(false);
    const [row] = await allRows();
    // The stale normalization of the OLD endpoint was never written over the new one.
    expect(row.endpoint_url).toBe("https://edited.example.com/a2a");
    expect(row.endpoint_url_normalized).toBeNull();

    const result = await reconcileEndpointUrlNormalized(db, { dryRun: false });
    expect(result).toMatchObject({ updated: 1, skippedConcurrentChange: 0 });
    expect((await allRows())[0].endpoint_url_normalized).toBe("https://edited.example.com/a2a");
  });

  it("writes nothing for a row that was deleted after the backfill read it", async () => {
    const agent = await createAgent(db, userA, baseInput);
    await client.query(`delete from public.agents where id = $1`, [agent.id]);

    const wrote = await setNormalizedEndpointIfUnchanged(db, {
      id: agent.id,
      expectedEndpointUrl: agent.endpointUrl,
      normalized: agent.endpointUrlNormalized,
    });

    expect(wrote).toBe(false);
    expect(await allRows()).toEqual([]);
  });
});
