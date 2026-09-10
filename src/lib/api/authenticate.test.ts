import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, seedUser } from "@/lib/db/test-harness";
import type { AppDatabase } from "@/lib/db/rls";
import { createApiKey, revokeApiKey } from "@/lib/db/queries/api-keys";
import { AppError, ErrorCode } from "@/lib/errors";
import { authenticateApiRequest } from "./authenticate";

const userA = "11111111-1111-1111-1111-111111111111";

let client: PGlite;
let db: AppDatabase;

beforeEach(async () => {
  const harness = await createTestDb();
  client = harness.client;
  db = harness.db;
  await seedUser(client, userA, "a@example.com");
});

afterEach(async () => {
  await client.close();
});

function requestWith(header?: string): Request {
  const headers = new Headers();
  if (header !== undefined) headers.set("authorization", header);
  return new Request("https://example.com/api/v1/agents", { headers });
}

describe("authenticateApiRequest", () => {
  it("resolves a valid Bearer key to its owning account", async () => {
    const { rawKey, key } = await createApiKey(db, userA, { name: "valid" });

    const result = await authenticateApiRequest(db, requestWith(`Bearer ${rawKey}`));
    expect(result).toMatchObject({ keyId: key.id, ownerId: userA });
  });

  it("rejects a missing Authorization header as UNAUTHENTICATED", async () => {
    await expect(
      authenticateApiRequest(db, requestWith(undefined)),
    ).rejects.toMatchObject({ code: ErrorCode.UNAUTHENTICATED });
  });

  it("rejects a header that isn't a Bearer token as UNAUTHENTICATED", async () => {
    await expect(
      authenticateApiRequest(db, requestWith("Basic dXNlcjpwYXNz")),
    ).rejects.toMatchObject({ code: ErrorCode.UNAUTHENTICATED });
  });

  it("rejects an invalid key as UNAUTHENTICATED", async () => {
    await expect(
      authenticateApiRequest(db, requestWith(`Bearer at_live_${"x".repeat(43)}`)),
    ).rejects.toMatchObject({ code: ErrorCode.UNAUTHENTICATED });
  });

  it("rejects a revoked key as UNAUTHENTICATED", async () => {
    const { rawKey, key } = await createApiKey(db, userA, { name: "to revoke" });
    await revokeApiKey(db, userA, key.id);

    await expect(
      authenticateApiRequest(db, requestWith(`Bearer ${rawKey}`)),
    ).rejects.toMatchObject({ code: ErrorCode.UNAUTHENTICATED });
  });

  it("throws an AppError instance, not a raw error", async () => {
    await expect(
      authenticateApiRequest(db, requestWith(undefined)),
    ).rejects.toBeInstanceOf(AppError);
  });
});
