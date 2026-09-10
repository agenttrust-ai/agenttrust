import "server-only";
import { randomBytes, createHmac } from "node:crypto";

const KEY_PREFIX = "at_live_";
/** 32 random bytes (256 bits) — comfortably infeasible to guess or brute-force. */
const SECRET_BYTES = 32;
/** How much of the full key is safe to display in the UI for identification. */
const DISPLAY_PREFIX_LENGTH = KEY_PREFIX.length + 6;

export type GeneratedApiKey = {
  /** The full secret — exists only in memory for this one request. Never persisted. */
  rawKey: string;
  /** Safe to store and display, e.g. "at_live_8f2c1a…". */
  keyPrefix: string;
};

/** Generates a new API key. Call once per key; never derived from anything guessable. */
export function generateApiKey(): GeneratedApiKey {
  const rawKey = KEY_PREFIX + randomBytes(SECRET_BYTES).toString("base64url");
  return { rawKey, keyPrefix: rawKey.slice(0, DISPLAY_PREFIX_LENGTH) };
}

/**
 * HMAC-SHA256(rawKey, pepper) — deterministic (so it can be looked up by
 * equality) but one-way and infeasible to reverse even with full database
 * access, since the pepper lives only in the server environment, never the
 * database. This is the *only* form of the key ever written to storage.
 */
export function hashApiKey(rawKey: string, pepper: string): string {
  return createHmac("sha256", pepper).update(rawKey).digest("hex");
}

/** A raw key must at least look like ours before it's worth a database round trip. */
export function looksLikeApiKey(rawKey: string): boolean {
  return (
    typeof rawKey === "string" &&
    rawKey.startsWith(KEY_PREFIX) &&
    rawKey.length > KEY_PREFIX.length + 20
  );
}
