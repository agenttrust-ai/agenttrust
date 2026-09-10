import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, seedUser } from "@/lib/db/test-harness";
import type { AppDatabase } from "@/lib/db/rls";
import { ErrorCode } from "@/lib/errors";
import {
  createApiKey,
  listApiKeysForOwner,
  revokeApiKey,
  verifyApiKey,
} from "./api-keys";

const userA = "11111111-1111-1111-1111-111111111111";
const userB = "22222222-2222-2222-2222-222222222222";

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

describe("createApiKey", () => {
  it("returns the raw key exactly once, alongside a display-safe summary", async () => {
    const { rawKey, key } = await createApiKey(db, userA, { name: "CI key" });

    expect(rawKey.startsWith("at_live_")).toBe(true);
    expect(key.name).toBe("CI key");
    expect(key.keyPrefix).toBeTruthy();
    expect(rawKey.startsWith(key.keyPrefix)).toBe(true);
    expect(key.revokedAt).toBeNull();
    expect(key.lastUsedAt).toBeNull();
  });

  it("never persists the raw key — only its hash and prefix reach the database", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "CI key" });

    const rows = await client.query<{ key_hash: string; key_prefix: string }>(
      `select key_hash, key_prefix from public.api_keys where owner_id = $1`,
      [userA],
    );
    expect(rows.rows).toHaveLength(1);
    const stored = rows.rows[0];
    expect(stored.key_hash).not.toBe(rawKey);
    expect(stored.key_hash).not.toContain(rawKey);
    expect(stored.key_prefix).not.toBe(rawKey);
    // The hash is a 64-char hex SHA-256 digest, structurally distinct from the raw key.
    expect(stored.key_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("creates two different keys with two different hashes for the same owner", async () => {
    const first = await createApiKey(db, userA, { name: "one" });
    const second = await createApiKey(db, userA, { name: "two" });
    expect(first.rawKey).not.toBe(second.rawKey);

    const keys = await listApiKeysForOwner(db, userA);
    expect(keys).toHaveLength(2);
  });
});

describe("listApiKeysForOwner — ownership isolation / RLS", () => {
  it("only ever returns the caller's own keys", async () => {
    await createApiKey(db, userA, { name: "A's key" });
    await createApiKey(db, userA, { name: "A's second key" });
    await createApiKey(db, userB, { name: "B's key" });

    const asA = await listApiKeysForOwner(db, userA);
    expect(asA).toHaveLength(2);
    expect(asA.every((k) => k.name.startsWith("A's"))).toBe(true);

    const asB = await listApiKeysForOwner(db, userB);
    expect(asB).toHaveLength(1);
    expect(asB[0].name).toBe("B's key");
  });

  it("returns an empty list, not an error, for an owner with no keys", async () => {
    expect(await listApiKeysForOwner(db, userA)).toEqual([]);
  });

  it("orders newest first", async () => {
    await createApiKey(db, userA, { name: "older" });
    await createApiKey(db, userA, { name: "newer" });
    const keys = await listApiKeysForOwner(db, userA);
    expect(keys.map((k) => k.name)).toEqual(["newer", "older"]);
  });
});

describe("revokeApiKey — ownership isolation", () => {
  it("lets the owner revoke their own key", async () => {
    const { key } = await createApiKey(db, userA, { name: "to revoke" });
    await revokeApiKey(db, userA, key.id);

    const keys = await listApiKeysForOwner(db, userA);
    expect(keys[0].revokedAt).not.toBeNull();
  });

  it("rejects revocation by a non-owner as NOT_FOUND and leaves the key active", async () => {
    const { key } = await createApiKey(db, userA, { name: "protected" });

    await expect(revokeApiKey(db, userB, key.id)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });

    const keys = await listApiKeysForOwner(db, userA);
    expect(keys[0].revokedAt).toBeNull();
  });

  it("rejects revoking an already-revoked key", async () => {
    const { key } = await createApiKey(db, userA, { name: "double revoke" });
    await revokeApiKey(db, userA, key.id);

    await expect(revokeApiKey(db, userA, key.id)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
  });

  it("rejects revoking a nonexistent key", async () => {
    await expect(
      revokeApiKey(db, userA, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });
});

describe("verifyApiKey", () => {
  it("resolves a valid raw key to its owning account", async () => {
    const { rawKey, key } = await createApiKey(db, userA, {
      name: "verify me",
    });

    const result = await verifyApiKey(db, rawKey);
    expect(result).toMatchObject({ keyId: key.id, ownerId: userA });
  });

  it("rejects a well-formed but incorrect key", async () => {
    await createApiKey(db, userA, { name: "real key" });
    const result = await verifyApiKey(db, "at_live_" + "x".repeat(43));
    expect(result).toBeNull();
  });

  it("rejects a key that doesn't even look like ours", async () => {
    expect(await verifyApiKey(db, "not-an-api-key")).toBeNull();
    expect(await verifyApiKey(db, "")).toBeNull();
  });

  it("rejects a revoked key", async () => {
    const { rawKey, key } = await createApiKey(db, userA, {
      name: "will revoke",
    });
    await revokeApiKey(db, userA, key.id);

    expect(await verifyApiKey(db, rawKey)).toBeNull();
  });

  it("updates last_used_at on successful verification", async () => {
    const { rawKey } = await createApiKey(db, userA, { name: "tracked" });
    expect((await listApiKeysForOwner(db, userA))[0].lastUsedAt).toBeNull();

    await verifyApiKey(db, rawKey);

    expect((await listApiKeysForOwner(db, userA))[0].lastUsedAt).not.toBeNull();
  });

  it("rejects an expired key", async () => {
    const { rawKey, key } = await createApiKey(db, userA, { name: "expiring" });
    await client.query(
      `update public.api_keys set expires_at = now() - interval '1 day' where id = $1`,
      [key.id],
    );

    expect(await verifyApiKey(db, rawKey)).toBeNull();
  });

  it("accepts a key with a future expiry", async () => {
    const { rawKey, key } = await createApiKey(db, userA, {
      name: "not yet expired",
    });
    await client.query(
      `update public.api_keys set expires_at = now() + interval '1 day' where id = $1`,
      [key.id],
    );

    expect(await verifyApiKey(db, rawKey)).not.toBeNull();
  });
});
