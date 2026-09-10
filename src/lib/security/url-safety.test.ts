import { describe, expect, it } from "vitest";
import { assertSafeAgentUrl, checkSafeAgentUrl } from "./url-safety";

describe("assertSafeAgentUrl — accepts", () => {
  it.each([
    "https://api.example.com/health",
    "https://agent.acme.io/v1/status",
    "https://sub.domain.example.com:8443/health",
    "https://93.184.216.34/health", // public IPv4
    "https://[2606:2800:220:1:248:1893:25c8:1946]/health", // public IPv6
  ])("%s", (url) => {
    expect(() => assertSafeAgentUrl(url)).not.toThrow();
  });
});

describe("assertSafeAgentUrl — rejects", () => {
  it.each([
    ["not a url at all", "invalid_url"],
    ["http://example.com/health", "invalid_protocol"], // not https
    ["ftp://example.com/health", "invalid_protocol"],
    ["https://user:pass@example.com/health", "credentials_in_url"],
    ["https://localhost/health", "localhost"],
    ["https://foo.localhost/health", "localhost"],
    ["https://127.0.0.1/health", "loopback"],
    ["https://127.55.0.1/health", "loopback"],
    ["https://[::1]/health", "loopback"],
    ["https://10.0.0.5/health", "private_range"],
    ["https://172.16.0.1/health", "private_range"],
    ["https://172.31.255.255/health", "private_range"],
    ["https://192.168.1.1/health", "private_range"],
    ["https://169.254.169.254/health", "link_local"], // cloud metadata
    ["https://169.254.1.1/health", "link_local"],
    ["https://[fe80::1]/health", "link_local"],
    ["https://[fc00::1]/health", "private_range"],
    ["https://[fd12:3456::1]/health", "private_range"],
    ["https://0.0.0.0/health", "reserved_range"],
    ["https://100.64.0.1/health", "private_range"], // CGNAT
    ["https://192.0.2.1/health", "reserved_range"], // TEST-NET-1
    ["https://198.51.100.1/health", "reserved_range"], // TEST-NET-2
    ["https://203.0.113.1/health", "reserved_range"], // TEST-NET-3
    ["https://224.0.0.1/health", "multicast_or_broadcast"],
    ["https://255.255.255.255/health", "multicast_or_broadcast"],
    ["https://api/health", "internal_hostname"], // no dot
    ["https://myagent.local/health", "internal_hostname"],
    ["https://service.internal/health", "internal_hostname"],
    ["https://box.corp/health", "internal_hostname"],
    ["https://router.home/health", "internal_hostname"],
    ["https://[::ffff:127.0.0.1]/health", "loopback"], // IPv4-mapped IPv6
  ] as const)("%s -> %s", (url, reason) => {
    const result = checkSafeAgentUrl(url);
    expect(result.safe).toBe(false);
    if (!result.safe) expect(result.reason).toBe(reason);
    expect(() => assertSafeAgentUrl(url)).toThrow();
  });
});

describe("checkSafeAgentUrl", () => {
  it("returns the parsed URL on success without throwing", () => {
    const result = checkSafeAgentUrl("https://example.com/health");
    expect(result.safe).toBe(true);
    if (result.safe) expect(result.url.hostname).toBe("example.com");
  });
});
