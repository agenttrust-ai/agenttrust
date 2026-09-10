import "server-only";
import { verifyApiKey, type VerifiedApiKey } from "@/lib/db/queries/api-keys";
import type { AppDatabase } from "@/lib/db/rls";
import { AppError, ErrorCode } from "@/lib/errors";

const BEARER_PREFIX = "Bearer ";

/**
 * The one place every /api/v1 route resolves who's calling. Reuses
 * `verifyApiKey` as-is — the same function that already rejects missing,
 * malformed, revoked, and expired keys, and already records `last_used_at`
 * on success (src/lib/db/queries/api-keys.ts), so authenticating a request
 * here is what keeps that column live for the Public API, not a separate
 * mechanism.
 */
export async function authenticateApiRequest(
  db: AppDatabase,
  request: Request,
): Promise<VerifiedApiKey> {
  const header = request.headers.get("authorization");

  if (!header || !header.startsWith(BEARER_PREFIX)) {
    throw new AppError(
      ErrorCode.UNAUTHENTICATED,
      "Missing API key. Provide one as: Authorization: Bearer <API_KEY>",
    );
  }

  const rawKey = header.slice(BEARER_PREFIX.length).trim();
  const verified = await verifyApiKey(db, rawKey);

  if (!verified) {
    // Deliberately the same message whether the key is malformed, unknown,
    // revoked, or expired — distinguishing them would let a caller use the
    // response to enumerate which part of a guess was right.
    throw new AppError(
      ErrorCode.UNAUTHENTICATED,
      "Invalid, expired, or revoked API key.",
    );
  }

  return verified;
}
