import dns from "node:dns";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkAgentHealth } from "./health-check";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockLookup(address: string) {
  vi.spyOn(dns, "lookup").mockImplementation(((
    _hostname: string,
    _opts: unknown,
    cb: (
      err: NodeJS.ErrnoException | null,
      address: string,
      family: number,
    ) => void,
  ) => {
    cb(null, address, 4);
  }) as typeof dns.lookup);
}

function mockLookupFailure(code: string) {
  vi.spyOn(dns, "lookup").mockImplementation(((
    _hostname: string,
    _opts: unknown,
    cb: (
      err: NodeJS.ErrnoException | null,
      address: string,
      family: number,
    ) => void,
  ) => {
    const err = new Error(code) as NodeJS.ErrnoException;
    err.code = code;
    cb(err, "", 4);
  }) as typeof dns.lookup);
}

describe("checkAgentHealth — retry composition", () => {
  it("does not retry a definitive SSRF rejection", async () => {
    // No lookup mock needed — assertSafeAgentUrl rejects the literal IP
    // before any DNS resolution happens.
    const result = await checkAgentHealth("https://127.0.0.1/health");
    expect(result.status).toBe("ssrf_blocked");
    expect(result.attempts).toBe(1);
  });

  it("retries a DNS failure up to the fixed attempt cap, then reports it", async () => {
    mockLookupFailure("ENOTFOUND");
    const result = await checkAgentHealth(
      "https://retries-and-fails.test.invalid/health",
    );
    expect(result.status).toBe("dns_error");
    expect(result.attempts).toBe(3);
  }, 10000);

  it("does not retry past the first attempt for a blocked (rebinding) target", async () => {
    mockLookup("169.254.169.254");
    const result = await checkAgentHealth(
      "https://rebinds-to-metadata.test.invalid/health",
    );
    expect(result.status).toBe("ssrf_blocked");
    expect(result.attempts).toBe(1);
  });
});
