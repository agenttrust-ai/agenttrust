import "server-only";
import dns from "node:dns";
import { Agent, fetch as undiciFetch } from "undici";
import {
  assertSafeAgentUrl,
  checkIpLiteralSafe,
} from "@/lib/security/url-safety";

export type CheckStatus =
  | "success"
  | "http_error"
  | "timeout"
  | "dns_error"
  | "tls_error"
  | "connection_error"
  | "ssrf_blocked"
  | "unknown_error";

export type FetchOutcome = {
  status: CheckStatus;
  success: boolean;
  httpStatus: number | null;
  latencyMs: number;
  errorCode: string | null;
  /** Already sanitized — safe to store and show to the agent's owner. */
  errorMessage: string | null;
};

/**
 * Matches Node's `net.LookupFunction` exactly — the custom `lookup` option
 * accepted by `net`/`tls` connect calls (and, through undici's connector, by
 * our `Agent`'s `connect.lookup`). Node's own connect logic calls this with
 * `options.all: true` for its dual-stack (Happy Eyeballs) path, expecting
 * the array form of the callback, and with `all` false/absent for the
 * single-address form — a real custom lookup has to answer both shapes.
 */
export type CustomLookup = (
  hostname: string,
  options: dns.LookupOptions,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | dns.LookupAddress[],
    family?: number,
  ) => void,
) => void;

const MAX_REDIRECTS = 5;
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 10_000;
const USER_AGENT = "AgentTrust-HealthCheck/1.0 (+https://agenttrust.dev)";

/**
 * Answers a lookup callback in whichever of the two shapes Node's
 * `net.LookupFunction` contract calls for (see `CustomLookup` above) —
 * the array form when `options.all` was requested, the plain
 * `(address, family)` form otherwise.
 */
function respond(
  options: dns.LookupOptions,
  callback: Parameters<CustomLookup>[2],
  err: NodeJS.ErrnoException | null,
  result: { address: string; family: 4 | 6 } | null,
) {
  if (err || !result) {
    callback(err, options.all ? [] : "", undefined);
    return;
  }
  if (options.all) {
    callback(null, [{ address: result.address, family: result.family }]);
  } else {
    callback(null, result.address, result.family);
  }
}

function outcome(
  status: CheckStatus,
  success: boolean,
  httpStatus: number | null,
  latencyMs: number,
  errorCode: string | null,
  errorMessage: string | null,
): FetchOutcome {
  return {
    status,
    success,
    httpStatus,
    latencyMs: Math.round(latencyMs),
    errorCode,
    errorMessage,
  };
}

/**
 * The DNS-rebinding defense: a hostname can pass registration-time
 * validation (public IP at the time) and later resolve somewhere private —
 * an attacker fully controls when. This `lookup` is the *only* DNS
 * resolution that ever happens for a health-check connection: Node's own
 * `net`/`tls` connect logic calls it directly and connects to whatever
 * address it hands back, so there is no separate "check" step a second,
 * differently-answered resolution could slip past. Validate here, or not
 * at all.
 */
export function createSafeLookup(): CustomLookup {
  return (hostname, options, callback) => {
    // Always resolve exactly one address ourselves — regardless of what the
    // caller's `options.all` asked for, only ever handing back the single
    // address we've validated below (see the module doc comment for why
    // this single-resolution design is the actual rebinding defense).
    dns.lookup(
      hostname,
      { family: 0, verbatim: true },
      (err, address, family) => {
        if (err) {
          respond(options, callback, err, null);
          return;
        }
        const familyNum: 4 | 6 = family === 6 ? 6 : 4;
        const check = checkIpLiteralSafe(address, familyNum);
        if (!check.safe) {
          const blocked = new Error(check.message) as NodeJS.ErrnoException;
          blocked.code = "SSRF_BLOCKED";
          respond(options, callback, blocked, null);
          return;
        }
        respond(options, callback, null, { address, family: familyNum });
      },
    );
  };
}

/**
 * A single already-decrypted credential header to attach to the outbound
 * request — `{name: "Authorization", value: "Bearer <token>"}` for authType
 * "bearer", `{name: <validated header name>, value: <key>}` for "api_key".
 * Callers (checkAgentHealth -> checkAgentEndpoint -> fetchWithGuard) must
 * decrypt immediately before passing this in and never log `value` —
 * nothing in this module logs it either, and it only ever reaches the
 * outbound `fetch` headers, never `FetchOutcome` or any error message.
 */
export type FetchAuthHeader = { name: string; value: string };

export type FetchWithGuardOptions = {
  /** Injectable so tests can point resolution at a local test server without going through real DNS. */
  lookup: CustomLookup;
  connectTimeoutMs?: number;
  totalTimeoutMs?: number;
  maxRedirects?: number;
  /**
   * Test-only: an extra CA certificate to trust, so tests can run a real
   * local HTTPS server with a self-signed cert instead of skipping TLS
   * verification. Never set in production — `rejectUnauthorized` stays at
   * its default (true) either way, this only widens the trust store.
   */
  extraCaCert?: string | Buffer;
  authHeader?: FetchAuthHeader;
};

/**
 * The network-mechanics layer: manual redirect following (every hop
 * re-validated with `assertSafeAgentUrl` — a redirect can point anywhere,
 * so it gets exactly the same gate the original URL did), bounded timeouts,
 * and failure classification. Takes its DNS `lookup` as a parameter rather
 * than hardcoding one, so the redirect/timeout/classification logic can be
 * tested against a local server without touching the real SSRF-blocking
 * resolver — `checkAgentEndpoint` below is what wires the production
 * lookup in.
 */
export async function fetchWithGuard(
  url: string,
  opts: FetchWithGuardOptions,
): Promise<FetchOutcome> {
  const {
    lookup,
    connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
    totalTimeoutMs = DEFAULT_TOTAL_TIMEOUT_MS,
    maxRedirects = MAX_REDIRECTS,
    extraCaCert,
    authHeader,
  } = opts;

  const start = performance.now();
  const agent = new Agent({
    connect: {
      lookup,
      timeout: connectTimeoutMs,
      ...(extraCaCert ? { ca: extraCaCert } : {}),
    },
    keepAliveTimeout: 1,
    keepAliveMaxTimeout: 1,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), totalTimeoutMs);

  try {
    let currentUrl = url;

    for (let hop = 0; hop <= maxRedirects; hop++) {
      try {
        assertSafeAgentUrl(currentUrl);
      } catch (error) {
        return outcome(
          "ssrf_blocked",
          false,
          null,
          performance.now() - start,
          "SSRF_BLOCKED",
          error instanceof Error ? error.message : "Blocked URL.",
        );
      }

      let response: Awaited<ReturnType<typeof undiciFetch>>;
      try {
        response = await undiciFetch(currentUrl, {
          method: "GET",
          redirect: "manual",
          dispatcher: agent,
          signal: controller.signal,
          headers: {
            "user-agent": USER_AGENT,
            // Same header (and value) sent on every redirect hop, exactly
            // like the user-agent above — no per-origin stripping. That's a
            // deliberate, spec-confirmed scoping decision, not an oversight.
            ...(authHeader ? { [authHeader.name]: authHeader.value } : {}),
          },
        });
      } catch (error) {
        return classifyNetworkError(error, performance.now() - start);
      }

      const isRedirect =
        response.status >= 300 &&
        response.status < 400 &&
        response.headers.has("location");

      if (isRedirect) {
        await response.body?.cancel().catch(() => {});
        let nextUrl: string;
        try {
          nextUrl = new URL(
            response.headers.get("location")!,
            currentUrl,
          ).toString();
        } catch {
          return outcome(
            "unknown_error",
            false,
            response.status,
            performance.now() - start,
            "INVALID_REDIRECT",
            "The endpoint returned an invalid redirect.",
          );
        }
        currentUrl = nextUrl;
        continue;
      }

      await response.body?.cancel().catch(() => {});
      const latencyMs = performance.now() - start;

      if (response.status >= 200 && response.status < 400) {
        return outcome("success", true, response.status, latencyMs, null, null);
      }
      return outcome(
        "http_error",
        false,
        response.status,
        latencyMs,
        `HTTP_${response.status}`,
        `The endpoint responded with HTTP ${response.status}.`,
      );
    }

    return outcome(
      "unknown_error",
      false,
      null,
      performance.now() - start,
      "TOO_MANY_REDIRECTS",
      "The endpoint redirected too many times.",
    );
  } finally {
    clearTimeout(timer);
    await agent.close().catch(() => {});
  }
}

/**
 * Maps a thrown network error to our status/code taxonomy without ever
 * passing the raw error message through — that message can contain
 * resolved IPs, ports, or file paths, none of which belong in a response
 * an agent owner (or, later, the public API) can see.
 */
function classifyNetworkError(error: unknown, elapsedMs: number): FetchOutcome {
  const err = error as
    | (Error & { code?: string; cause?: { code?: string; message?: string } })
    | undefined;
  const code = err?.code ?? err?.cause?.code;
  const name = err?.name;
  const message =
    `${err?.message ?? ""} ${err?.cause?.message ?? ""}`.toLowerCase();

  if (
    name === "AbortError" ||
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "UND_ERR_HEADERS_TIMEOUT" ||
    code === "UND_ERR_BODY_TIMEOUT" ||
    code === "ETIMEDOUT"
  ) {
    return outcome(
      "timeout",
      false,
      null,
      elapsedMs,
      code ?? "TIMEOUT",
      "The endpoint took too long to respond.",
    );
  }

  if (code === "SSRF_BLOCKED") {
    return outcome(
      "ssrf_blocked",
      false,
      null,
      elapsedMs,
      "SSRF_BLOCKED",
      "The endpoint resolved to a blocked network address.",
    );
  }

  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "ENODATA") {
    return outcome(
      "dns_error",
      false,
      null,
      elapsedMs,
      code,
      "The endpoint's domain name couldn't be resolved.",
    );
  }

  if (
    (typeof code === "string" &&
      (code.startsWith("ERR_TLS") || code.startsWith("ERR_SSL"))) ||
    message.includes("certificate") ||
    message.includes("ssl routines") ||
    message.includes("wrong version number")
  ) {
    return outcome(
      "tls_error",
      false,
      null,
      elapsedMs,
      code ?? "TLS_ERROR",
      "The endpoint's TLS/SSL certificate couldn't be verified.",
    );
  }

  if (
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "EHOSTUNREACH" ||
    code === "ENETUNREACH" ||
    code === "EPIPE"
  ) {
    return outcome(
      "connection_error",
      false,
      null,
      elapsedMs,
      code,
      "A connection to the endpoint couldn't be established.",
    );
  }

  return outcome(
    "unknown_error",
    false,
    null,
    elapsedMs,
    code ?? "UNKNOWN_ERROR",
    "The health check couldn't be completed.",
  );
}

/**
 * The production entry point: registration-time-style validation on the
 * original URL, then the redirect/timeout-bounded fetch using the real
 * DNS-rebinding-safe resolver. This is what the health-check runner calls.
 */
export async function checkAgentEndpoint(
  url: string,
  authHeader?: FetchAuthHeader,
): Promise<FetchOutcome> {
  const start = performance.now();
  try {
    assertSafeAgentUrl(url);
  } catch (error) {
    return outcome(
      "ssrf_blocked",
      false,
      null,
      performance.now() - start,
      "SSRF_BLOCKED",
      error instanceof Error ? error.message : "Blocked URL.",
    );
  }

  return fetchWithGuard(url, { lookup: createSafeLookup(), authHeader });
}

/** Hard cap on how much of a verification-file response body is ever read into memory. */
const VERIFICATION_MAX_BODY_BYTES = 4_096;
const VERIFICATION_CONNECT_TIMEOUT_MS = 5_000;
const VERIFICATION_TOTAL_TIMEOUT_MS = 8_000;

export type VerificationFetchOutcome =
  | { success: true; body: string }
  | { success: false; errorCode: string; errorMessage: string };

/**
 * Fetches a small text resource (the ownership-verification well-known
 * file) under the same SSRF defenses as `fetchWithGuard` — same DNS-
 * rebinding-safe `lookup`, same per-hop `assertSafeAgentUrl` revalidation,
 * same bounded connect/total timeouts — but, unlike every other fetch in
 * this module, actually reads the response body (health checks always
 * discard it). Reading is capped at `VERIFICATION_MAX_BODY_BYTES`: the
 * stream is aborted the instant that's exceeded, so a misconfigured or
 * hostile server streaming gigabytes back can never be read into memory.
 *
 * Deliberately a sibling function rather than a `fetchWithGuard` option:
 * that function's `FetchOutcome`/health-check callers never need a body,
 * and threading one through would touch tested, unrelated code for a
 * concern only this feature has.
 */
export type FetchOwnershipVerificationOptions = {
  /** Injectable so tests can point resolution at a local test server without going through real DNS. Defaults to the real DNS-rebinding-safe resolver. */
  lookup?: CustomLookup;
  connectTimeoutMs?: number;
  totalTimeoutMs?: number;
  /** Test-only: an extra CA certificate to trust, same purpose as `FetchWithGuardOptions.extraCaCert`. */
  extraCaCert?: string | Buffer;
};

export async function fetchOwnershipVerificationFile(
  url: string,
  opts: FetchOwnershipVerificationOptions = {},
): Promise<VerificationFetchOutcome> {
  const {
    lookup = createSafeLookup(),
    connectTimeoutMs = VERIFICATION_CONNECT_TIMEOUT_MS,
    totalTimeoutMs = VERIFICATION_TOTAL_TIMEOUT_MS,
    extraCaCert,
  } = opts;

  try {
    assertSafeAgentUrl(url);
  } catch (error) {
    return {
      success: false,
      errorCode: "SSRF_BLOCKED",
      errorMessage: error instanceof Error ? error.message : "Blocked URL.",
    };
  }

  const agent = new Agent({
    connect: {
      lookup,
      timeout: connectTimeoutMs,
      ...(extraCaCert ? { ca: extraCaCert } : {}),
    },
    keepAliveTimeout: 1,
    keepAliveMaxTimeout: 1,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), totalTimeoutMs);

  try {
    let currentUrl = url;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      try {
        assertSafeAgentUrl(currentUrl);
      } catch (error) {
        return {
          success: false,
          errorCode: "SSRF_BLOCKED",
          errorMessage: error instanceof Error ? error.message : "Blocked URL.",
        };
      }

      let response: Awaited<ReturnType<typeof undiciFetch>>;
      try {
        response = await undiciFetch(currentUrl, {
          method: "GET",
          redirect: "manual",
          dispatcher: agent,
          signal: controller.signal,
          headers: { "user-agent": USER_AGENT },
        });
      } catch (error) {
        const classified = classifyNetworkError(error, 0);
        return {
          success: false,
          errorCode: classified.errorCode ?? "UNKNOWN_ERROR",
          errorMessage:
            classified.errorMessage ?? "The verification check couldn't be completed.",
        };
      }

      const isRedirect =
        response.status >= 300 &&
        response.status < 400 &&
        response.headers.has("location");

      if (isRedirect) {
        await response.body?.cancel().catch(() => {});
        let nextUrl: string;
        try {
          nextUrl = new URL(
            response.headers.get("location")!,
            currentUrl,
          ).toString();
        } catch {
          return {
            success: false,
            errorCode: "INVALID_REDIRECT",
            errorMessage: "The verification endpoint returned an invalid redirect.",
          };
        }
        currentUrl = nextUrl;
        continue;
      }

      if (response.status !== 200) {
        await response.body?.cancel().catch(() => {});
        return {
          success: false,
          errorCode: `HTTP_${response.status}`,
          errorMessage: `The verification endpoint responded with HTTP ${response.status}.`,
        };
      }

      const reader = response.body?.getReader();
      if (!reader) {
        return {
          success: false,
          errorCode: "EMPTY_BODY",
          errorMessage: "The verification endpoint returned no body.",
        };
      }

      let receivedBytes = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        receivedBytes += value.byteLength;
        if (receivedBytes > VERIFICATION_MAX_BODY_BYTES) {
          await reader.cancel().catch(() => {});
          return {
            success: false,
            errorCode: "TOO_LARGE",
            errorMessage: "The verification endpoint's response was too large.",
          };
        }
        chunks.push(value);
      }
      return { success: true, body: Buffer.concat(chunks).toString("utf8") };
    }

    return {
      success: false,
      errorCode: "TOO_MANY_REDIRECTS",
      errorMessage: "The verification endpoint redirected too many times.",
    };
  } finally {
    clearTimeout(timer);
    await agent.close().catch(() => {});
  }
}
