import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, seedUser } from "@/lib/db/test-harness";
import type { AppDatabase } from "@/lib/db/rls";
vi.mock("@/lib/monitoring/safe-fetch", () => ({
  fetchOwnershipVerificationFile: vi.fn(),
}));
import {
  activateOwnedAgent,
  checkOwnershipVerification,
  createAgent,
  recordAgentHeartbeatBySlug,
  startOwnershipVerification,
  updateOwnedAgent,
  type Agent,
} from "@/lib/db/queries/agents";
import { recordHealthCheck, setAgentStatus } from "@/lib/db/queries/health-checks";
import { createApiKey, revokeApiKey, verifyApiKey } from "@/lib/db/queries/api-keys";
import { fetchOwnershipVerificationFile } from "@/lib/monitoring/safe-fetch";
import type { AgentInput } from "@/lib/validation/agent";

/**
 * Migration 0011: what a signed-in owner can and can't write through the
 * Supabase Data API. PostgREST runs a signed-in request as the
 * `authenticated` role with the user's id as the JWT `sub` claim — exactly
 * what `asOwner` below sets up — so these tests exercise the real grants,
 * RLS policies and triggers, not a mock of them.
 */

const mockedFetch = vi.mocked(fetchOwnershipVerificationFile);

const userA = "11111111-1111-1111-1111-111111111111";
const userB = "22222222-2222-2222-2222-222222222222";

const input: AgentInput = {
  name: "Support Bot",
  description: "Handles tier-1 support.",
  endpointUrl: "https://agent.acme.io/v1/invoke",
  version: "1.0.0",
  capabilities: ["chat"],
  authType: "none",
};

/** The only agents columns the `authenticated` role may update. */
const OWNER_EDITABLE_COLUMNS = [
  "agent_card",
  "capability_tags",
  "description",
  "name",
  "updated_at",
  "version",
];

let client: PGlite;
let db: AppDatabase;

beforeEach(async () => {
  const harness = await createTestDb();
  client = harness.client;
  db = harness.db;
  await seedUser(client, userA, "a@example.com");
  await seedUser(client, userB, "b@example.com");
  mockedFetch.mockReset();
});

afterEach(async () => {
  await client.close();
});

/** Runs one statement the way the Data API would for a signed-in user. */
function asOwner(userId: string, statement: string, params: unknown[] = []) {
  return client.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    await tx.query("set local role authenticated");
    return tx.query(statement, params);
  });
}

async function readAgent(id: string) {
  const { rows } = await client.query<Record<string, unknown>>(
    "select * from public.agents where id = $1",
    [id],
  );
  return rows[0];
}

async function verifyThroughProofFlow(agent: Agent): Promise<Agent> {
  const started = await startOwnershipVerification(db, userA, agent.id);
  mockedFetch.mockResolvedValue({ success: true, body: started.ownershipVerificationToken! });
  return checkOwnershipVerification(db, userA, agent.id);
}

describe("authenticated role privileges on agents (as granted by migration 0011)", () => {
  it("may update exactly the owner-editable columns, and insert none", async () => {
    const { rows } = await client.query<{ column_name: string; can_update: boolean; can_insert: boolean }>(
      `select column_name,
              has_column_privilege('authenticated', 'public.agents', column_name, 'UPDATE') as can_update,
              has_column_privilege('authenticated', 'public.agents', column_name, 'INSERT') as can_insert
         from information_schema.columns
        where table_schema = 'public' and table_name = 'agents'`,
    );
    expect(rows.filter((r) => r.can_update).map((r) => r.column_name).sort()).toEqual(OWNER_EDITABLE_COLUMNS);
    expect(rows.filter((r) => r.can_insert).map((r) => r.column_name)).toEqual([]);
  });
});

describe("a signed-in owner cannot forge server-only agent columns through the Data API", () => {
  it.each([
    ["ownership_verified_at", "now()"],
    ["ownership_verification_token", "'forged-token'"],
    ["ownership_last_checked_at", "now()"],
    ["current_status", "'healthy'"],
    ["last_heartbeat_at", "now()"],
    ["next_check_at", "now()"],
    ["last_verified_at", "now()"],
    ["monitoring_mode", "'push'"],
    ["source", "'externally_observed'"],
    ["external_registry_id", "'forged-registry-id'"],
    ["discovered_at", "now()"],
    ["owner_id", `'${userB}'`],
    ["id", "gen_random_uuid()"],
    ["created_at", "now()"],
    ["slug", "'forged-slug'"],
    ["endpoint_url_normalized", "'https://forged.example.com/x'"],
    ["lifecycle_status", "'active'"],
    ["endpoint_url", "'https://elsewhere.example.com/v1/invoke'"],
    ["auth_credential_ciphertext", "'forged'"],
  ])("rejects a direct update of %s on the owner's own agent", async (column, value) => {
    const agent = await createAgent(db, userA, input);
    const before = await readAgent(agent.id);

    await expect(
      asOwner(userA, `update public.agents set ${column} = ${value} where id = $1`, [agent.id]),
    ).rejects.toThrow(/permission denied/);
    expect(await readAgent(agent.id)).toEqual(before);
  });

  it("rejects forging a verified, healthy, freshly-heartbeating agent in one request", async () => {
    const agent = await createAgent(db, userA, input);
    await expect(
      asOwner(
        userA,
        `update public.agents
            set ownership_verified_at = now(), current_status = 'healthy', last_heartbeat_at = now()
          where id = $1`,
        [agent.id],
      ),
    ).rejects.toThrow(/permission denied/);
    const after = await readAgent(agent.id);
    expect(after.ownership_verified_at).toBeNull();
    expect(after.current_status).toBe("unknown");
    expect(after.last_heartbeat_at).toBeNull();
  });

  it("rejects creating an agent directly, even one owned by the caller and pre-verified", async () => {
    await expect(
      asOwner(
        userA,
        `insert into public.agents (owner_id, slug, name, endpoint_url, ownership_verified_at)
         values ($1, 'self-made', 'Self Made', 'https://self.example.com', now())`,
        [userA],
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("rejects TRUNCATE, which would bypass RLS entirely", async () => {
    await expect(asOwner(userA, "truncate public.agents")).rejects.toThrow(/permission denied/);
  });
});

describe("legitimate owner edits still work", () => {
  it("a direct update of the owner-editable columns succeeds on the owner's own agent", async () => {
    const agent = await createAgent(db, userA, input);
    const result = await asOwner(
      userA,
      `update public.agents
          set name = 'Renamed', description = 'New description', version = '2.0.0',
              capability_tags = '{chat,search}', agent_card = '{"modalities":["text"]}', updated_at = now()
        where id = $1`,
      [agent.id],
    );
    expect(result.affectedRows).toBe(1);
    const after = await readAgent(agent.id);
    expect(after).toMatchObject({ name: "Renamed", description: "New description", version: "2.0.0" });
    expect(after.capability_tags).toEqual(["chat", "search"]);
  });

  it("the same direct update can't touch another owner's agent (RLS still scopes rows)", async () => {
    const othersAgent = await createAgent(db, userB, input);
    const result = await asOwner(userA, "update public.agents set name = 'Hijacked' where id = $1", [
      othersAgent.id,
    ]);
    expect(result.affectedRows).toBe(0);
    expect((await readAgent(othersAgent.id)).name).toBe("Support Bot");
  });

  it("the application still updates every form field, including the endpoint", async () => {
    const agent = await createAgent(db, userA, input);
    const updated = await updateOwnedAgent(db, userA, agent.id, {
      ...input,
      name: "Support Bot v2",
      endpointUrl: "https://agent.acme.io/v2/invoke/",
      authType: "bearer",
      authCredential: "new-token",
    });
    expect(updated.name).toBe("Support Bot v2");
    expect(updated.endpointUrl).toBe("https://agent.acme.io/v2/invoke/");
    expect(updated.endpointUrlNormalized).toBe("https://agent.acme.io/v2/invoke");
    expect(updated.authType).toBe("bearer");
    expect(updated.authCredentialCiphertext).not.toBeNull();
  });

  it("the application still can't update another owner's agent", async () => {
    const othersAgent = await createAgent(db, userB, input);
    await expect(updateOwnedAgent(db, userA, othersAgent.id, { ...input, name: "Hijacked" })).rejects.toThrow();
    expect((await readAgent(othersAgent.id)).name).toBe("Support Bot");
  });
});

describe("changing the endpoint clears ownership verification in the database", () => {
  it("through the application flow", async () => {
    const verified = await verifyThroughProofFlow(await createAgent(db, userA, input));
    expect(verified.ownershipVerifiedAt).not.toBeNull();

    const moved = await updateOwnedAgent(db, userA, verified.id, {
      ...input,
      endpointUrl: "https://other-origin.example.com/v1/invoke",
    });
    expect(moved.ownershipVerifiedAt).toBeNull();
    expect(moved.ownershipVerificationToken).toBeNull();
  });

  it("through any other write path too — the trigger clears it even when the writer doesn't", async () => {
    const verified = await verifyThroughProofFlow(await createAgent(db, userA, input));

    await client.query("update public.agents set endpoint_url = $2 where id = $1", [
      verified.id,
      "https://other-origin.example.com/v1/invoke",
    ]);
    const after = await readAgent(verified.id);
    expect(after.ownership_verified_at).toBeNull();
    expect(after.ownership_verification_token).toBeNull();
  });

  it("keeps verification when the endpoint is written but unchanged, or another column changes", async () => {
    const verified = await verifyThroughProofFlow(await createAgent(db, userA, input));

    await client.query("update public.agents set endpoint_url = endpoint_url, name = 'Renamed' where id = $1", [
      verified.id,
    ]);
    const after = await readAgent(verified.id);
    expect(after.ownership_verified_at).not.toBeNull();
    expect(after.ownership_verification_token).toBe(verified.ownershipVerificationToken);
  });
});

describe("trusted server paths still write the protected columns", () => {
  it("the proof-check flow sets ownership_verified_at", async () => {
    const verified = await verifyThroughProofFlow(await createAgent(db, userA, input));
    expect(verified.ownershipVerifiedAt).toBeInstanceOf(Date);
    expect(verified.ownershipLastCheckedAt).toBeInstanceOf(Date);
  });

  it("activation sets lifecycle_status", async () => {
    const agent = await createAgent(db, userA, input);
    expect((await activateOwnedAgent(db, userA, agent.id)).lifecycleStatus).toBe("active");
  });

  it("a heartbeat sets last_heartbeat_at, and only for the owner", async () => {
    const agent = await createAgent(db, userA, input);
    const at = new Date();
    expect((await recordAgentHeartbeatBySlug(db, userA, agent.slug, at)).lastHeartbeatAt).toEqual(at);
    await expect(recordAgentHeartbeatBySlug(db, userB, agent.slug, new Date())).rejects.toThrow();
  });

  it("monitoring records health checks and sets current_status", async () => {
    const agent = await createAgent(db, userA, input);
    await recordHealthCheck(db, agent.id, {
      status: "success",
      success: true,
      latencyMs: 120,
      httpStatus: 200,
      errorCode: null,
      errorMessage: null,
    });
    await setAgentStatus(db, agent.id, "healthy");
    expect((await readAgent(agent.id)).current_status).toBe("healthy");
  });
});

describe("api_keys: revocation is final", () => {
  it("lets the owner revoke a key, through the application or directly", async () => {
    const first = await createApiKey(db, userA, { name: "first" });
    const second = await createApiKey(db, userA, { name: "second" });

    await revokeApiKey(db, userA, first.key.id);
    const direct = await asOwner(userA, "update public.api_keys set revoked_at = now() where id = $1", [
      second.key.id,
    ]);
    expect(direct.affectedRows).toBe(1);
    expect(await verifyApiKey(db, first.rawKey)).toBeNull();
    expect(await verifyApiKey(db, second.rawKey)).toBeNull();
  });

  it("rejects un-revoking a key, from the owner or any other path", async () => {
    const { rawKey, key } = await createApiKey(db, userA, { name: "k" });
    await revokeApiKey(db, userA, key.id);

    await expect(
      asOwner(userA, "update public.api_keys set revoked_at = null where id = $1", [key.id]),
    ).rejects.toThrow(/revocation is permanent/);
    await expect(
      client.query("update public.api_keys set revoked_at = null where id = $1", [key.id]),
    ).rejects.toThrow(/revocation is permanent/);
    expect(await verifyApiKey(db, rawKey)).toBeNull();
  });

  it.each([
    ["expires_at", "now() + interval '10 years'"],
    ["key_hash", "'forged-hash'"],
    ["scopes", "'{read,write}'"],
    ["owner_id", `'${userB}'`],
    ["name", "'renamed'"],
  ])("rejects a direct update of api_keys.%s", async (column, value) => {
    const { key } = await createApiKey(db, userA, { name: "k" });
    await expect(
      asOwner(userA, `update public.api_keys set ${column} = ${value} where id = $1`, [key.id]),
    ).rejects.toThrow(/permission denied/);
  });

  it("still records last_used_at from the trusted authentication path", async () => {
    const { rawKey, key } = await createApiKey(db, userA, { name: "k" });
    await verifyApiKey(db, rawKey);
    const { rows } = await client.query<{ last_used_at: Date | null }>(
      "select last_used_at from public.api_keys where id = $1",
      [key.id],
    );
    expect(rows[0].last_used_at).toBeInstanceOf(Date);
  });
});
