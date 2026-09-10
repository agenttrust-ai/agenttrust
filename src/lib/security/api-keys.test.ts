import { describe, expect, it } from "vitest";
import { generateApiKey, hashApiKey, looksLikeApiKey } from "./api-keys";

const PEPPER_A = "a".repeat(32);
const PEPPER_B = "b".repeat(32);

describe("generateApiKey", () => {
  it("produces a key with the expected prefix and sufficient length", () => {
    const { rawKey } = generateApiKey();
    expect(rawKey.startsWith("at_live_")).toBe(true);
    // 32 random bytes base64url-encoded is ~43 chars, plus the "at_live_" prefix.
    expect(rawKey.length).toBeGreaterThan(45);
  });

  it("derives keyPrefix as a short, safe-to-display slice of the raw key", () => {
    const { rawKey, keyPrefix } = generateApiKey();
    expect(rawKey.startsWith(keyPrefix)).toBe(true);
    expect(keyPrefix.length).toBeLessThan(20);
  });

  it("never generates the same raw key twice", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(generateApiKey().rawKey);
    }
    expect(seen.size).toBe(200);
  });
});

describe("hashApiKey", () => {
  it("is deterministic for the same key and pepper", () => {
    const { rawKey } = generateApiKey();
    expect(hashApiKey(rawKey, PEPPER_A)).toBe(hashApiKey(rawKey, PEPPER_A));
  });

  it("produces a different hash for a different key", () => {
    const a = generateApiKey().rawKey;
    const b = generateApiKey().rawKey;
    expect(hashApiKey(a, PEPPER_A)).not.toBe(hashApiKey(b, PEPPER_A));
  });

  it("produces a different hash for a different pepper — losing the pepper invalidates every key", () => {
    const { rawKey } = generateApiKey();
    expect(hashApiKey(rawKey, PEPPER_A)).not.toBe(hashApiKey(rawKey, PEPPER_B));
  });

  it("never leaks the raw key or pepper into the hash's own representation", () => {
    const { rawKey } = generateApiKey();
    const hash = hashApiKey(rawKey, PEPPER_A);
    expect(hash).not.toContain(rawKey);
    expect(hash).not.toContain(PEPPER_A);
    // A hex-encoded SHA-256 digest is always exactly 64 characters.
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("looksLikeApiKey", () => {
  it("accepts a real generated key", () => {
    expect(looksLikeApiKey(generateApiKey().rawKey)).toBe(true);
  });

  it("rejects strings without the expected prefix", () => {
    expect(looksLikeApiKey("sk_live_something")).toBe(false);
  });

  it("rejects an empty or too-short string", () => {
    expect(looksLikeApiKey("")).toBe(false);
    expect(looksLikeApiKey("at_live_short")).toBe(false);
  });
});
