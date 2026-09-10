import "server-only";
import { isIP } from "node:net";

export type UnsafeUrlReason =
  | "invalid_url"
  | "invalid_protocol"
  | "credentials_in_url"
  | "localhost"
  | "loopback"
  | "private_range"
  | "link_local"
  | "reserved_range"
  | "multicast_or_broadcast"
  | "internal_hostname";

export class UnsafeUrlError extends Error {
  readonly reason: UnsafeUrlReason;
  constructor(reason: UnsafeUrlReason, message: string) {
    super(message);
    this.name = "UnsafeUrlError";
    this.reason = reason;
  }
}

export type UrlSafetyResult =
  { safe: true } | { safe: false; reason: UnsafeUrlReason; message: string };

const INTERNAL_TLDS = [
  "local",
  "internal",
  "corp",
  "home",
  "lan",
  "intranet",
  "localdomain",
];

/**
 * Registration-time SSRF guard: rejects endpoint URLs that name AgentTrust's
 * own infrastructure or private networks, checked against the literal
 * hostname/IP the user submitted. This is deliberately NOT a DNS-resolution
 * check — a hostname safe today can be re-pointed via DNS after
 * registration (DNS rebinding), which is why the health-check path
 * (src/lib/monitoring/safe-fetch.ts) re-validates the *resolved* IP at the
 * moment it connects, every time, using `checkIpLiteralSafe` below. This
 * function's job is only to block the obvious case before anything is
 * stored, and to reject non-IP hostnames the resolution-time check can't
 * see coming (bare hostnames, internal TLDs).
 */
export function assertSafeAgentUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError("invalid_url", "Enter a valid URL.");
  }

  if (url.protocol !== "https:") {
    throw new UnsafeUrlError(
      "invalid_protocol",
      "The endpoint URL must use https://.",
    );
  }

  // Credentials embedded in the URL (https://user:pass@host/...) have no
  // legitimate use for a health-check target and are a common way to
  // obscure the real destination host.
  if (url.username || url.password) {
    throw new UnsafeUrlError(
      "credentials_in_url",
      "The endpoint URL must not contain a username or password.",
    );
  }

  // WHATWG URL keeps the brackets on an IPv6 literal host (e.g. "[::1]") —
  // strip them so isIP() and the IPv6 checks below see the bare address.
  const hostname = url.hostname
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^\[|\]$/g, "");

  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new UnsafeUrlError(
      "localhost",
      "The endpoint URL can't point at localhost.",
    );
  }

  const ipVersion = isIP(hostname);
  if (ipVersion === 4) {
    assertSafeIPv4(hostname);
  } else if (ipVersion === 6) {
    assertSafeIPv6(hostname);
  } else {
    assertSafeHostname(hostname);
  }

  return url;
}

/** Non-throwing variant — returns a reason instead of throwing, for callers that want to keep control flow simple. */
export function checkSafeAgentUrl(
  rawUrl: string,
):
  | { safe: true; url: URL }
  | { safe: false; reason: UnsafeUrlReason; message: string } {
  try {
    const url = assertSafeAgentUrl(rawUrl);
    return { safe: true, url };
  } catch (error) {
    if (error instanceof UnsafeUrlError) {
      return { safe: false, reason: error.reason, message: error.message };
    }
    throw error;
  }
}

/**
 * Validates a bare IP address on its own — the same private/loopback/
 * link-local/reserved rules `assertSafeAgentUrl` applies to a literal IP
 * host, exposed standalone so the health-check connector can apply them to
 * a hostname's *resolved* address at connect time (DNS-rebinding defense).
 */
export function checkIpLiteralSafe(ip: string, family: 4 | 6): UrlSafetyResult {
  try {
    if (family === 4) assertSafeIPv4(ip);
    else assertSafeIPv6(ip);
    return { safe: true };
  } catch (error) {
    if (error instanceof UnsafeUrlError) {
      return { safe: false, reason: error.reason, message: error.message };
    }
    throw error;
  }
}

function assertSafeHostname(hostname: string) {
  const labels = hostname.split(".");

  // A bare, dot-less hostname (e.g. "http://api/") virtually always resolves
  // via a local search domain to something on the caller's own network.
  if (labels.length < 2) {
    throw new UnsafeUrlError(
      "internal_hostname",
      "The endpoint URL must use a fully qualified domain name.",
    );
  }

  const tld = labels[labels.length - 1];
  if (INTERNAL_TLDS.includes(tld)) {
    throw new UnsafeUrlError(
      "internal_hostname",
      `The endpoint URL can't use the .${tld} domain.`,
    );
  }
}

function assertSafeIPv4(ip: string) {
  const octets = ip.split(".").map(Number);
  const [a, b] = octets;

  if (a === 127) {
    throw new UnsafeUrlError(
      "loopback",
      "The endpoint URL can't be a loopback address.",
    );
  }
  if (a === 0) {
    throw new UnsafeUrlError(
      "reserved_range",
      "The endpoint URL can't use a reserved IP range.",
    );
  }
  if (a === 10) {
    throw new UnsafeUrlError(
      "private_range",
      "The endpoint URL can't be a private network address.",
    );
  }
  if (a === 172 && b >= 16 && b <= 31) {
    throw new UnsafeUrlError(
      "private_range",
      "The endpoint URL can't be a private network address.",
    );
  }
  if (a === 192 && b === 168) {
    throw new UnsafeUrlError(
      "private_range",
      "The endpoint URL can't be a private network address.",
    );
  }
  // Link-local, including the cloud metadata address 169.254.169.254.
  if (a === 169 && b === 254) {
    throw new UnsafeUrlError(
      "link_local",
      "The endpoint URL can't be a link-local address.",
    );
  }
  // Carrier-grade NAT.
  if (a === 100 && b >= 64 && b <= 127) {
    throw new UnsafeUrlError(
      "private_range",
      "The endpoint URL can't be a private network address.",
    );
  }
  // Documentation/test ranges (RFC 5737) and other reserved blocks.
  if (
    (a === 192 && b === 0 && octets[2] === 0) || // 192.0.0.0/24
    (a === 192 && b === 0 && octets[2] === 2) || // 192.0.2.0/24 (TEST-NET-1)
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15 (benchmarking)
    (a === 198 && b === 51 && octets[2] === 100) || // TEST-NET-2
    (a === 203 && b === 0 && octets[2] === 113) // TEST-NET-3
  ) {
    throw new UnsafeUrlError(
      "reserved_range",
      "The endpoint URL can't use a reserved IP range.",
    );
  }
  if (a >= 224) {
    // 224.0.0.0/4 multicast, 240.0.0.0/4 reserved, 255.255.255.255 broadcast.
    throw new UnsafeUrlError(
      "multicast_or_broadcast",
      "The endpoint URL can't use a multicast or reserved IP range.",
    );
  }
}

function assertSafeIPv6(ip: string) {
  // Node normalizes bracket-free but keeps the canonical form; lowercase it.
  const addr = ip.toLowerCase();

  if (addr === "::1") {
    throw new UnsafeUrlError(
      "loopback",
      "The endpoint URL can't be a loopback address.",
    );
  }
  if (addr === "::") {
    throw new UnsafeUrlError(
      "reserved_range",
      "The endpoint URL can't use a reserved IP range.",
    );
  }
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — re-check the embedded IPv4 address.
  // The WHATWG URL parser normalizes the dotted-decimal suffix into two hex
  // groups (e.g. "::ffff:127.0.0.1" becomes "::ffff:7f00:1"), so match both.
  const dotted = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const hex = addr.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (dotted) {
    assertSafeIPv4(dotted[1]);
    return;
  }
  if (hex) {
    const bits = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16);
    const ipv4 = [
      (bits >>> 24) & 0xff,
      (bits >>> 16) & 0xff,
      (bits >>> 8) & 0xff,
      bits & 0xff,
    ].join(".");
    assertSafeIPv4(ipv4);
    return;
  }
  // Unique local addresses (fc00::/7).
  if (addr.startsWith("fc") || addr.startsWith("fd")) {
    throw new UnsafeUrlError(
      "private_range",
      "The endpoint URL can't be a private network address.",
    );
  }
  // Link-local (fe80::/10).
  if (/^fe[89ab][0-9a-f]:/.test(addr)) {
    throw new UnsafeUrlError(
      "link_local",
      "The endpoint URL can't be a link-local address.",
    );
  }
}
