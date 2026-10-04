import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckStatus, FetchOutcome } from "./safe-fetch";

// checkAgentHealth's real retry policy, driven by stubbed endpoint outcomes:
// the production fetch can't reach a local test server (its SSRF-safe DNS
// lookup blocks loopback by design), and this file only checks how many
// attempts each outcome gets.
const checkAgentEndpoint = vi.hoisted(() => vi.fn<() => Promise<FetchOutcome>>());
vi.mock("./safe-fetch", () => ({ checkAgentEndpoint }));

const { checkAgentHealth } = await import("./health-check");

function outcome(status: CheckStatus, success: boolean, httpStatus: number | null): FetchOutcome {
  return { status, success, httpStatus, latencyMs: 1, errorCode: null, errorMessage: null };
}

beforeEach(() => {
  checkAgentEndpoint.mockReset();
});

describe("checkAgentHealth — retry behaviour by outcome", () => {
  it.each([200, 301, 401, 403, 405, 406])(
    "does not retry a reachable %i response",
    async (httpStatus) => {
      checkAgentEndpoint.mockResolvedValue(outcome("success", true, httpStatus));
      const result = await checkAgentHealth("https://agent.example.com/mcp");
      expect(result).toMatchObject({ success: true, httpStatus, attempts: 1 });
      expect(checkAgentEndpoint).toHaveBeenCalledTimes(1);
    },
  );

  it.each([400, 404, 500, 503])("does not retry an http_error %i", async (httpStatus) => {
    checkAgentEndpoint.mockResolvedValue(outcome("http_error", false, httpStatus));
    const result = await checkAgentHealth("https://agent.example.com/mcp");
    expect(result).toMatchObject({ success: false, httpStatus, attempts: 1 });
    expect(checkAgentEndpoint).toHaveBeenCalledTimes(1);
  });

  it.each(["timeout", "dns_error", "connection_error"] as const)(
    "retries a %s up to 3 attempts",
    async (status) => {
      checkAgentEndpoint.mockResolvedValue(outcome(status, false, null));
      const result = await checkAgentHealth("https://agent.example.com/mcp");
      expect(result).toMatchObject({ status, success: false, attempts: 3 });
      expect(checkAgentEndpoint).toHaveBeenCalledTimes(3);
    },
    10_000,
  );

  it.each(["tls_error", "ssrf_blocked", "unknown_error"] as const)("does not retry a %s", async (status) => {
    checkAgentEndpoint.mockResolvedValue(outcome(status, false, null));
    const result = await checkAgentHealth("https://agent.example.com/mcp");
    expect(result).toMatchObject({ status, attempts: 1 });
  });
});
