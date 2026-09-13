import { describe, expect, it } from "vitest";
import {
  WELL_KNOWN_VERIFICATION_PATH,
  buildVerificationUrl,
  generateVerificationToken,
  tokenMatches,
} from "./ownership";

describe("generateVerificationToken", () => {
  it("produces a hex string of the expected length", () => {
    const token = generateVerificationToken();
    expect(token).toMatch(/^[0-9a-f]{48}$/);
  });

  it("never generates the same token twice", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(generateVerificationToken());
    }
    expect(seen.size).toBe(200);
  });
});

describe("buildVerificationUrl", () => {
  it("builds the well-known path at the endpoint's origin", () => {
    expect(buildVerificationUrl("https://agent.example.com/v1/invoke")).toBe(
      `https://agent.example.com${WELL_KNOWN_VERIFICATION_PATH}`,
    );
  });

  it("drops the endpoint's own path, query, and port handling — only the origin is kept", () => {
    expect(
      buildVerificationUrl("https://agent.example.com:8443/deep/path?x=1"),
    ).toBe(`https://agent.example.com:8443${WELL_KNOWN_VERIFICATION_PATH}`);
  });

  it("is the same for two endpoints that share an origin", () => {
    const a = buildVerificationUrl("https://agent.example.com/v1/a");
    const b = buildVerificationUrl("https://agent.example.com/v2/b");
    expect(a).toBe(b);
  });
});

describe("tokenMatches", () => {
  it("matches an exact value", () => {
    expect(tokenMatches("abc123", "abc123")).toBe(true);
  });

  it("tolerates surrounding whitespace/newlines in the served file", () => {
    expect(tokenMatches("  abc123\n", "abc123")).toBe(true);
    expect(tokenMatches("\r\nabc123\r\n", "abc123")).toBe(true);
  });

  it("rejects a mismatched value", () => {
    expect(tokenMatches("wrong-value", "abc123")).toBe(false);
  });

  it("rejects a value that only partially matches (substring is not enough)", () => {
    expect(tokenMatches("abc123extra", "abc123")).toBe(false);
    expect(tokenMatches("abc12", "abc123")).toBe(false);
  });

  it("is case-sensitive", () => {
    expect(tokenMatches("ABC123", "abc123")).toBe(false);
  });

  it("rejects internal whitespace even though surrounding whitespace is trimmed", () => {
    expect(tokenMatches("abc 123", "abc123")).toBe(false);
  });
});
