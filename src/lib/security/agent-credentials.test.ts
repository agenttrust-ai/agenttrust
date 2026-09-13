import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decryptAgentCredential, encryptAgentCredential } from "./agent-credentials";

const KEY_A = randomBytes(32).toString("hex");
const KEY_B = randomBytes(32).toString("hex");

describe("encryptAgentCredential / decryptAgentCredential", () => {
  it("round-trips a plaintext credential", () => {
    const plaintext = "sk-live-super-secret-token-12345";
    const ciphertext = encryptAgentCredential(plaintext, KEY_A);
    expect(decryptAgentCredential(ciphertext, KEY_A)).toBe(plaintext);
  });

  it("round-trips an empty-ish edge case (long random token)", () => {
    const plaintext = randomBytes(64).toString("base64url");
    const ciphertext = encryptAgentCredential(plaintext, KEY_A);
    expect(decryptAgentCredential(ciphertext, KEY_A)).toBe(plaintext);
  });

  it("never contains the plaintext as a substring of the ciphertext", () => {
    const plaintext = "Bearer abcdefghijklmnopqrstuvwxyz";
    const ciphertext = encryptAgentCredential(plaintext, KEY_A);
    expect(ciphertext).not.toContain(plaintext);
    expect(ciphertext.toLowerCase()).not.toContain(plaintext.toLowerCase());
  });

  it("produces different ciphertext for the same plaintext on each call (random IV)", () => {
    const plaintext = "same-credential-value";
    const a = encryptAgentCredential(plaintext, KEY_A);
    const b = encryptAgentCredential(plaintext, KEY_A);
    expect(a).not.toBe(b);
    expect(decryptAgentCredential(a, KEY_A)).toBe(plaintext);
    expect(decryptAgentCredential(b, KEY_A)).toBe(plaintext);
  });

  it("fails to decrypt with the wrong key", () => {
    const ciphertext = encryptAgentCredential("secret-value", KEY_A);
    expect(() => decryptAgentCredential(ciphertext, KEY_B)).toThrow();
  });

  it("fails to decrypt tampered ciphertext (auth tag mismatch)", () => {
    const ciphertext = encryptAgentCredential("secret-value", KEY_A);
    const raw = Buffer.from(ciphertext, "base64");
    raw[raw.length - 1] ^= 0xff; // flip the last ciphertext byte
    const tampered = raw.toString("base64");
    expect(() => decryptAgentCredential(tampered, KEY_A)).toThrow();
  });

  it("rejects a key that isn't 32 bytes of hex", () => {
    expect(() => encryptAgentCredential("value", "too-short")).toThrow();
    expect(() => encryptAgentCredential("value", "ab".repeat(32))).not.toThrow(); // sanity: valid 32-byte key
    expect(() => encryptAgentCredential("value", "ab".repeat(10))).toThrow();
  });

  it("rejects malformed stored ciphertext on decrypt", () => {
    expect(() => decryptAgentCredential("not-valid-base64-ciphertext!!", KEY_A)).toThrow();
    expect(() => decryptAgentCredential(Buffer.from("short").toString("base64"), KEY_A)).toThrow();
  });
});
