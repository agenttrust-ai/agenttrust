import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import { generate as generateSelfSignedCert } from "selfsigned";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  checkAgentEndpoint,
  fetchWithGuard,
  fetchOwnershipVerificationFile,
  createSafeLookup,
  type CustomLookup,
  type FetchAuthHeader,
} from "./safe-fetch";

// Resolves our fixed fake hostname straight to the local test server —
// bypasses real DNS entirely, but does NOT bypass the SSRF checks in
// fetchWithGuard/checkAgentEndpoint, which still run against every hop.
const testLookup: CustomLookup = (hostname, options, callback) => {
  if (options.all) callback(null, [{ address: "127.0.0.1", family: 4 }]);
  else callback(null, "127.0.0.1", 4);
};

function withPort(path: string, port: number) {
  return `https://agent.test.invalid:${port}${path}`;
}

let server: https.Server;
let port: number;
let cert: { private: string; public: string; cert: string };

beforeAll(async () => {
  // selfsigned's generate() is async in this version — and defaults to a
  // SHA-1 cert signature, which Node's TLS stack now refuses to negotiate,
  // so both `algorithm` and `await` here matter.
  cert = await generateSelfSignedCert(
    [{ name: "commonName", value: "agent.test.invalid" }],
    {
      notAfterDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      keySize: 2048,
      algorithm: "sha256",
      extensions: [
        {
          name: "subjectAltName",
          altNames: [{ type: 2, value: "agent.test.invalid" }],
        },
      ],
    },
  );

  server = https.createServer(
    { key: cert.private, cert: cert.cert },
    (req, res) => {
      const url = req.url ?? "/";
      if (url === "/ok") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("ok");
        return;
      }
      if (url === "/slow-ok") {
        setTimeout(() => {
          res.writeHead(200);
          res.end("ok");
        }, 150);
        return;
      }
      if (url === "/notfound") {
        res.writeHead(404);
        res.end("nope");
        return;
      }
      if (url === "/error") {
        res.writeHead(500);
        res.end("boom");
        return;
      }
      if (url === "/redirect-safe") {
        res.writeHead(302, { Location: "/ok" });
        res.end();
        return;
      }
      if (url === "/redirect-private") {
        res.writeHead(302, { Location: "https://127.0.0.1/meta" });
        res.end();
        return;
      }
      if (url === "/redirect-localhost") {
        res.writeHead(302, { Location: "https://localhost/x" });
        res.end();
        return;
      }
      if (url === "/redirect-loop") {
        res.writeHead(302, { Location: "/redirect-loop" });
        res.end();
        return;
      }
      if (url === "/require-bearer") {
        if (req.headers.authorization === "Bearer secret-token") {
          res.writeHead(200);
          res.end("ok");
        } else {
          res.writeHead(401);
          res.end("unauthorized");
        }
        return;
      }
      if (url === "/redirect-to-require-bearer") {
        res.writeHead(302, { Location: "/require-bearer" });
        res.end();
        return;
      }
      if (url === "/require-api-key") {
        if (req.headers["x-custom-key"] === "my-api-key") {
          res.writeHead(200);
          res.end("ok");
        } else {
          res.writeHead(403);
          res.end("forbidden");
        }
        return;
      }
      if (url === "/slow") {
        setTimeout(() => {
          res.writeHead(200);
          res.end("too slow");
        }, 3000);
        return;
      }
      if (url === "/.well-known/agenttrust-verification.txt") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("the-correct-token\n");
        return;
      }
      if (url === "/redirect-to-verification-file") {
        res.writeHead(302, { Location: "/.well-known/agenttrust-verification.txt" });
        res.end();
        return;
      }
      if (url === "/verification-too-large") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("x".repeat(10_000));
        return;
      }
      if (url === "/verification-slow") {
        setTimeout(() => {
          res.writeHead(200);
          res.end("the-correct-token");
        }, 500);
        return;
      }
      res.writeHead(404);
      res.end();
    },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchWithGuard — successful checks", () => {
  it("reports success with the HTTP status and a measured latency", async () => {
    const result = await fetchWithGuard(withPort("/ok", port), {
      lookup: testLookup,
      extraCaCert: cert.cert,
    });
    expect(result).toMatchObject({
      status: "success",
      success: true,
      httpStatus: 200,
    });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.errorCode).toBeNull();
  });

  it("measures latency that reflects real response delay", async () => {
    const result = await fetchWithGuard(withPort("/slow-ok", port), {
      lookup: testLookup,
      extraCaCert: cert.cert,
    });
    expect(result.success).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(120);
  });
});

describe("fetchWithGuard — HTTP-level failures", () => {
  it("classifies a 404 as http_error, not a connection failure", async () => {
    const result = await fetchWithGuard(withPort("/notfound", port), {
      lookup: testLookup,
      extraCaCert: cert.cert,
    });
    expect(result).toMatchObject({
      status: "http_error",
      success: false,
      httpStatus: 404,
      errorCode: "HTTP_404",
    });
  });

  it("classifies a 500 as http_error", async () => {
    const result = await fetchWithGuard(withPort("/error", port), {
      lookup: testLookup,
      extraCaCert: cert.cert,
    });
    expect(result).toMatchObject({
      status: "http_error",
      success: false,
      httpStatus: 500,
      errorCode: "HTTP_500",
    });
  });
});

describe("fetchWithGuard — redirects", () => {
  it("follows a redirect to a safe target and reports the final result", async () => {
    const result = await fetchWithGuard(withPort("/redirect-safe", port), {
      lookup: testLookup,
      extraCaCert: cert.cert,
    });
    expect(result).toMatchObject({ status: "success", httpStatus: 200 });
  });

  it("blocks a redirect to a private IP literal instead of following it", async () => {
    const result = await fetchWithGuard(withPort("/redirect-private", port), {
      lookup: testLookup,
      extraCaCert: cert.cert,
    });
    expect(result).toMatchObject({ status: "ssrf_blocked", success: false });
  });

  it("blocks a redirect to localhost instead of following it", async () => {
    const result = await fetchWithGuard(withPort("/redirect-localhost", port), {
      lookup: testLookup,
      extraCaCert: cert.cert,
    });
    expect(result).toMatchObject({ status: "ssrf_blocked", success: false });
  });

  it("gives up after too many redirects rather than looping forever", async () => {
    const result = await fetchWithGuard(withPort("/redirect-loop", port), {
      lookup: testLookup,
      extraCaCert: cert.cert,
      maxRedirects: 2,
    });
    expect(result).toMatchObject({
      status: "unknown_error",
      errorCode: "TOO_MANY_REDIRECTS",
    });
  });
});

describe("fetchWithGuard — timeouts", () => {
  it("aborts a hanging request once the total timeout elapses", async () => {
    const result = await fetchWithGuard(withPort("/slow", port), {
      lookup: testLookup,
      extraCaCert: cert.cert,
      totalTimeoutMs: 300,
    });
    expect(result.status).toBe("timeout");
    expect(result.success).toBe(false);
    // Aborted well before the server's own 3s delay would have resolved it.
    expect(result.latencyMs).toBeLessThan(2000);
  }, 10000);
});

describe("fetchWithGuard — DNS failures", () => {
  it("classifies a resolution failure as dns_error", async () => {
    const failingLookup: CustomLookup = (hostname, options, callback) => {
      const err = new Error("getaddrinfo ENOTFOUND") as NodeJS.ErrnoException;
      err.code = "ENOTFOUND";
      callback(err, options.all ? [] : "", undefined);
    };
    const result = await fetchWithGuard(
      "https://does-not-resolve.test.invalid/x",
      {
        lookup: failingLookup,
      },
    );
    expect(result).toMatchObject({
      status: "dns_error",
      success: false,
      errorCode: "ENOTFOUND",
    });
    expect(result.errorMessage).not.toContain("getaddrinfo");
  });
});

describe("fetchWithGuard — TLS failures", () => {
  it("classifies a TLS handshake failure (protocol mismatch) as tls_error", async () => {
    // A plain HTTP server on the other end of an https:// request fails the
    // TLS handshake itself — a real failure, not a simulated one.
    const plainServer = http.createServer((_req, res) => res.end("plain"));
    await new Promise<void>((resolve) =>
      plainServer.listen(0, "127.0.0.1", resolve),
    );
    const plainPort = (plainServer.address() as { port: number }).port;

    try {
      const result = await fetchWithGuard(withPort("/ok", plainPort), {
        lookup: testLookup,
        totalTimeoutMs: 5000,
      });
      expect(result.status).toBe("tls_error");
      expect(result.success).toBe(false);
    } finally {
      await new Promise((resolve) => plainServer.close(resolve));
    }
  });
});

describe("fetchWithGuard — connection failures", () => {
  it("classifies a refused connection as connection_error", async () => {
    // Bind and immediately close a server to get a port nothing is listening on.
    const probe = http.createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const deadPort = (probe.address() as { port: number }).port;
    await new Promise((resolve) => probe.close(resolve));

    const result = await fetchWithGuard(withPort("/ok", deadPort), {
      lookup: testLookup,
      totalTimeoutMs: 3000,
    });
    expect(result).toMatchObject({
      status: "connection_error",
      success: false,
      errorCode: "ECONNREFUSED",
    });
  });
});

describe("checkAgentEndpoint — production entry point", () => {
  it("rejects a literal private IP with no network attempt at all", async () => {
    const result = await checkAgentEndpoint("https://127.0.0.1/health");
    expect(result).toMatchObject({ status: "ssrf_blocked", success: false });
    expect(result.latencyMs).toBeLessThan(50);
  });

  it("rejects a plain-http URL immediately", async () => {
    const result = await checkAgentEndpoint("http://example.com/health");
    expect(result).toMatchObject({ status: "ssrf_blocked", success: false });
  });

  it("blocks a hostname that resolves (DNS rebinding) to a cloud metadata address", async () => {
    // The hostname itself looks completely ordinary; only its *resolved*
    // address is unsafe. This is exactly the rebinding scenario
    // registration-time validation can't see — proving createSafeLookup
    // catches it at connect time is the point of this test.
    vi.spyOn(dns, "lookup").mockImplementation(((
      _hostname: string,
      opts: unknown,
      cb: (
        err: NodeJS.ErrnoException | null,
        address: string,
        family: number,
      ) => void,
    ) => {
      cb(null, "169.254.169.254", 4);
    }) as typeof dns.lookup);

    const result = await checkAgentEndpoint(
      "https://looks-fine.test.invalid/health",
    );
    expect(result).toMatchObject({ status: "ssrf_blocked", success: false });
  });

  it("blocks a hostname that resolves to a private RFC1918 address", async () => {
    vi.spyOn(dns, "lookup").mockImplementation(((
      _hostname: string,
      opts: unknown,
      cb: (
        err: NodeJS.ErrnoException | null,
        address: string,
        family: number,
      ) => void,
    ) => {
      cb(null, "10.0.0.55", 4);
    }) as typeof dns.lookup);

    const result = await checkAgentEndpoint(
      "https://also-looks-fine.test.invalid/health",
    );
    expect(result).toMatchObject({ status: "ssrf_blocked", success: false });
  });
});

describe("createSafeLookup", () => {
  it("answers the array-form callback when options.all is requested", async () => {
    vi.spyOn(dns, "lookup").mockImplementation(((
      _hostname: string,
      _opts: unknown,
      cb: (
        err: NodeJS.ErrnoException | null,
        address: string,
        family: number,
      ) => void,
    ) => {
      cb(null, "93.184.216.34", 4);
    }) as typeof dns.lookup);

    const lookup = createSafeLookup();
    const result = await new Promise((resolve) => {
      lookup("example.com", { all: true }, (err, address) =>
        resolve({ err, address }),
      );
    });
    expect(result).toEqual({
      err: null,
      address: [{ address: "93.184.216.34", family: 4 }],
    });
  });

  it("answers the single-form callback when options.all is not set", async () => {
    vi.spyOn(dns, "lookup").mockImplementation(((
      _hostname: string,
      _opts: unknown,
      cb: (
        err: NodeJS.ErrnoException | null,
        address: string,
        family: number,
      ) => void,
    ) => {
      cb(null, "93.184.216.34", 4);
    }) as typeof dns.lookup);

    const lookup = createSafeLookup();
    const result = await new Promise((resolve) => {
      lookup("example.com", {}, (err, address, family) =>
        resolve({ err, address, family }),
      );
    });
    expect(result).toEqual({ err: null, address: "93.184.216.34", family: 4 });
  });
});

describe("fetchWithGuard — authenticated requests", () => {
  it("attaches a bearer auth header, so a bearer-protected endpoint succeeds", async () => {
    const authHeader: FetchAuthHeader = {
      name: "Authorization",
      value: "Bearer secret-token",
    };
    const result = await fetchWithGuard(withPort("/require-bearer", port), {
      lookup: testLookup,
      extraCaCert: cert.cert,
      authHeader,
    });
    expect(result).toMatchObject({ status: "success", success: true, httpStatus: 200 });
  });

  it("reports http_error 401, not a network failure, when no auth header is attached to a protected endpoint", async () => {
    const result = await fetchWithGuard(withPort("/require-bearer", port), {
      lookup: testLookup,
      extraCaCert: cert.cert,
    });
    expect(result).toMatchObject({ status: "http_error", success: false, httpStatus: 401 });
  });

  it("reports http_error 401 when the wrong bearer value is attached", async () => {
    const result = await fetchWithGuard(withPort("/require-bearer", port), {
      lookup: testLookup,
      extraCaCert: cert.cert,
      authHeader: { name: "Authorization", value: "Bearer wrong-token" },
    });
    expect(result).toMatchObject({ status: "http_error", success: false, httpStatus: 401 });
  });

  it("attaches a custom api_key header, so an api-key-protected endpoint succeeds", async () => {
    const authHeader: FetchAuthHeader = { name: "X-Custom-Key", value: "my-api-key" };
    const result = await fetchWithGuard(withPort("/require-api-key", port), {
      lookup: testLookup,
      extraCaCert: cert.cert,
      authHeader,
    });
    expect(result).toMatchObject({ status: "success", success: true, httpStatus: 200 });
  });

  it("reports http_error 403 when the api_key header is missing", async () => {
    const result = await fetchWithGuard(withPort("/require-api-key", port), {
      lookup: testLookup,
      extraCaCert: cert.cert,
    });
    expect(result).toMatchObject({ status: "http_error", success: false, httpStatus: 403 });
  });

  it("carries the same auth header across a redirect hop", async () => {
    const authHeader: FetchAuthHeader = {
      name: "Authorization",
      value: "Bearer secret-token",
    };
    const result = await fetchWithGuard(
      withPort("/redirect-to-require-bearer", port),
      { lookup: testLookup, extraCaCert: cert.cert, authHeader },
    );
    expect(result).toMatchObject({ status: "success", success: true, httpStatus: 200 });
  });

  it("never includes the auth header value anywhere in the returned outcome (status/error fields only)", async () => {
    const authHeader: FetchAuthHeader = {
      name: "Authorization",
      value: "Bearer secret-token",
    };
    const result = await fetchWithGuard(withPort("/notfound", port), {
      lookup: testLookup,
      extraCaCert: cert.cert,
      authHeader,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("secret-token");
  });
});

describe("fetchOwnershipVerificationFile", () => {
  it("returns the response body on a successful fetch", async () => {
    const result = await fetchOwnershipVerificationFile(
      withPort("/.well-known/agenttrust-verification.txt", port),
      { lookup: testLookup, extraCaCert: cert.cert },
    );
    expect(result).toEqual({ success: true, body: "the-correct-token\n" });
  });

  it("follows a redirect to reach the file", async () => {
    const result = await fetchOwnershipVerificationFile(
      withPort("/redirect-to-verification-file", port),
      { lookup: testLookup, extraCaCert: cert.cert },
    );
    expect(result).toEqual({ success: true, body: "the-correct-token\n" });
  });

  it("fails with a safe error on a non-200 response, never exposing raw response content", async () => {
    const result = await fetchOwnershipVerificationFile(withPort("/notfound", port), {
      lookup: testLookup,
      extraCaCert: cert.cert,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe("HTTP_404");
      expect(result.errorMessage).not.toContain("nope"); // the /notfound route's actual body text
    }
  });

  it("fails with a safe error on a 500 response", async () => {
    const result = await fetchOwnershipVerificationFile(withPort("/error", port), {
      lookup: testLookup,
      extraCaCert: cert.cert,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorCode).toBe("HTTP_500");
  });

  it("rejects a response body larger than the size cap, without reading it all into memory first", async () => {
    const result = await fetchOwnershipVerificationFile(
      withPort("/verification-too-large", port),
      { lookup: testLookup, extraCaCert: cert.cert },
    );
    expect(result).toEqual({
      success: false,
      errorCode: "TOO_LARGE",
      errorMessage: "The verification endpoint's response was too large.",
    });
  });

  it("times out on a slow endpoint", async () => {
    const result = await fetchOwnershipVerificationFile(withPort("/verification-slow", port), {
      lookup: testLookup,
      extraCaCert: cert.cert,
      totalTimeoutMs: 100,
    });
    expect(result.success).toBe(false);
    // errorCode's exact value depends on how Node surfaces the abort (a
    // DOMException's `.code` can be numeric) — the fixed, safe message is
    // the reliable, meaningful assertion, same reasoning `fetchWithGuard`'s
    // own timeout test already applies (it only checks `status`, not the
    // raw code, for exactly this reason).
    if (!result.success) {
      expect(result.errorMessage).toBe("The endpoint took too long to respond.");
    }
  });

  it("blocks a request to a private IP literal (SSRF)", async () => {
    const result = await fetchOwnershipVerificationFile("https://127.0.0.1/.well-known/agenttrust-verification.txt", {
      lookup: testLookup,
      extraCaCert: cert.cert,
    });
    expect(result).toMatchObject({ success: false, errorCode: "SSRF_BLOCKED" });
  });

  it("blocks a redirect that points at a private IP literal", async () => {
    const result = await fetchOwnershipVerificationFile(withPort("/redirect-private", port), {
      lookup: testLookup,
      extraCaCert: cert.cert,
    });
    expect(result).toMatchObject({ success: false, errorCode: "SSRF_BLOCKED" });
  });

  it("gives up after too many redirects", async () => {
    const result = await fetchOwnershipVerificationFile(withPort("/redirect-loop", port), {
      lookup: testLookup,
      extraCaCert: cert.cert,
    });
    expect(result).toMatchObject({ success: false, errorCode: "TOO_MANY_REDIRECTS" });
  });

  it("classifies a DNS resolution failure safely", async () => {
    const dnsFailLookup: CustomLookup = (_hostname, _options, callback) => {
      const err = new Error("not found") as NodeJS.ErrnoException;
      err.code = "ENOTFOUND";
      callback(err, "", undefined);
    };
    const result = await fetchOwnershipVerificationFile(
      "https://this-does-not-matter.invalid/.well-known/agenttrust-verification.txt",
      { lookup: dnsFailLookup },
    );
    expect(result).toMatchObject({ success: false, errorCode: "ENOTFOUND" });
  });
});
