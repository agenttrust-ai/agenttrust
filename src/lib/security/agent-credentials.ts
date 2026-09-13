import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // recommended nonce length for GCM
const AUTH_TAG_BYTES = 16;

/** `AGENT_CREDENTIAL_ENCRYPTION_KEY` — 64 lowercase/uppercase hex chars (32 bytes). */
function decodeKey(keyHex: string): Buffer {
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `Agent credential encryption key must decode to ${KEY_BYTES} bytes (64 hex chars), got ${key.length}.`,
    );
  }
  return key;
}

/**
 * Encrypts a monitored-endpoint credential (bearer token or API key value)
 * for storage. Reversible by design — unlike `hashApiKey`, which is a
 * one-way HMAC used to *verify* AgentTrust's own API keys, this must be
 * decryptable so the plaintext can be reattached to outbound monitoring
 * requests. `key` is always the dedicated `AGENT_CREDENTIAL_ENCRYPTION_KEY`,
 * never a hashing secret like `API_KEY_HASH_PEPPER` or `CRON_SECRET`.
 *
 * Output layout: base64(iv[12] || authTag[16] || ciphertext).
 */
export function encryptAgentCredential(plaintext: string, keyHex: string): string {
  const key = decodeKey(keyHex);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

/**
 * Reverses `encryptAgentCredential`. Throws if `stored` is malformed or the
 * auth tag doesn't verify (wrong key, or the ciphertext was tampered with) —
 * callers must not swallow this into a silent empty credential.
 */
export function decryptAgentCredential(stored: string, keyHex: string): string {
  const key = decodeKey(keyHex);
  const raw = Buffer.from(stored, "base64");
  if (raw.length < IV_BYTES + AUTH_TAG_BYTES) {
    throw new Error("Stored agent credential is too short to be valid.");
  }
  const iv = raw.subarray(0, IV_BYTES);
  const authTag = raw.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES + AUTH_TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
