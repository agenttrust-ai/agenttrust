import "server-only";
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { apiKeys } from "@/lib/db/schema";
import {
  withDbErrorNormalization,
  withUserContext,
  type AppDatabase,
} from "@/lib/db/rls";
import { AppError, ErrorCode } from "@/lib/errors";
import { env } from "@/lib/config.server";
import {
  generateApiKey,
  hashApiKey,
  looksLikeApiKey,
} from "@/lib/security/api-keys";
import type { CreateApiKeyInput } from "@/lib/validation/api-key";

/**
 * What the owner's dashboard is allowed to see for a key — deliberately
 * excludes `keyHash`. It can't be reversed into the raw key, but there's no
 * reason to ever put it on the wire to a client either.
 */
export type ApiKeySummary = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date | null;
};

const SUMMARY_COLUMNS = {
  id: apiKeys.id,
  name: apiKeys.name,
  keyPrefix: apiKeys.keyPrefix,
  scopes: apiKeys.scopes,
  createdAt: apiKeys.createdAt,
  lastUsedAt: apiKeys.lastUsedAt,
  revokedAt: apiKeys.revokedAt,
  expiresAt: apiKeys.expiresAt,
};

const API_KEY_NOT_FOUND = "No active API key found with that id.";

/**
 * Creates a new key and returns the raw secret exactly once — nothing
 * after this function ever has access to it again. Only its HMAC hash and
 * a short display prefix are persisted; `ApiKeySummary` (what every other
 * function here returns) never carries the raw value or even the hash.
 */
export async function createApiKey(
  db: AppDatabase,
  ownerId: string,
  input: CreateApiKeyInput,
): Promise<{ rawKey: string; key: ApiKeySummary }> {
  const { rawKey, keyPrefix } = generateApiKey();
  const keyHash = hashApiKey(rawKey, env.API_KEY_HASH_PEPPER);

  const key = await withUserContext(db, ownerId, async (tx) => {
    const [row] = await tx
      .insert(apiKeys)
      .values({
        ownerId,
        name: input.name,
        keyPrefix,
        keyHash,
        scopes: ["read"],
      })
      .returning(SUMMARY_COLUMNS);
    return row;
  });

  return { rawKey, key };
}

export async function listApiKeysForOwner(
  db: AppDatabase,
  ownerId: string,
): Promise<ApiKeySummary[]> {
  return withUserContext(db, ownerId, (tx) =>
    tx
      .select(SUMMARY_COLUMNS)
      .from(apiKeys)
      .where(eq(apiKeys.ownerId, ownerId))
      .orderBy(desc(apiKeys.createdAt)),
  );
}

/** Soft-delete (sets revoked_at) — the row stays for audit/usage history, the key just stops validating. */
export async function revokeApiKey(
  db: AppDatabase,
  ownerId: string,
  keyId: string,
): Promise<void> {
  await withUserContext(db, ownerId, async (tx) => {
    const [row] = await tx
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(apiKeys.id, keyId),
          eq(apiKeys.ownerId, ownerId),
          isNull(apiKeys.revokedAt),
        ),
      )
      .returning({ id: apiKeys.id });
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, API_KEY_NOT_FOUND);
  });
}

export type VerifiedApiKey = {
  keyId: string;
  ownerId: string;
  agentId: string | null;
  scopes: string[];
};

/**
 * Resolves a raw API key (as presented by a caller, e.g. an
 * `Authorization: Bearer at_live_...` header) to the account it belongs
 * to — this is how a request's identity gets established in the first
 * place, so it necessarily runs before any `ownerId` is known and can't be
 * scoped through `withUserContext`. Runs as the trusted service context,
 * same as the health-check cron's DB access.
 *
 * Returns null for anything that isn't a live, unexpired, unrevoked key —
 * deliberately without distinguishing *why*, so a caller can't use error
 * detail to enumerate which part of a guess was wrong.
 */
export async function verifyApiKey(
  db: AppDatabase,
  rawKey: string,
): Promise<VerifiedApiKey | null> {
  if (!looksLikeApiKey(rawKey)) return null;
  const keyHash = hashApiKey(rawKey, env.API_KEY_HASH_PEPPER);

  return withDbErrorNormalization(async () => {
    const [row] = await db
      .select({
        id: apiKeys.id,
        ownerId: apiKeys.ownerId,
        agentId: apiKeys.agentId,
        scopes: apiKeys.scopes,
      })
      .from(apiKeys)
      .where(
        and(
          eq(apiKeys.keyHash, keyHash),
          isNull(apiKeys.revokedAt),
          or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, sql`now()`)),
        ),
      )
      .limit(1);

    if (!row) return null;

    try {
      await db
        .update(apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiKeys.id, row.id));
    } catch {
      // Recording last-used is best-effort — a failure here must never
      // block authentication for an otherwise-valid key.
    }

    return {
      keyId: row.id,
      ownerId: row.ownerId,
      agentId: row.agentId,
      scopes: row.scopes,
    };
  });
}
