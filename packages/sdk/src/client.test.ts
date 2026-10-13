import { describe, expect, it, vi } from "vitest";
import {
  AgentTrustError,
  NotTrustedError,
  createAgentTrustClient,
  evaluatePolicy,
  type MatchedTrustResult,
  type TrustCheckResult,
} from "./index.js";

const ENDPOINT = "https://agenttrust.test/api/mcp/public";

const matched: MatchedTrustResult = {
  matched: true,
  slug: "support-bot",
  name: "Support Bot",
  status: "healthy",
  verified: true,
  reliabilityScore: 100,
  reliabilityScoreStatus: "fresh",
  trustDecision: { recommended: true, confidence: "high", reasons: [] },
};

type Call = { url: string; init: RequestInit; body: Record<string, unknown> };

/** A fetch stub that records calls and answers with the given responses in order. */
function fetchStub(...responses: (Response | Error | (() => Promise<Response>))[]) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {}, body: JSON.parse(String(init?.body)) });
    const next = responses.shift();
    if (!next) throw new Error("no more stubbed responses");
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next() : next;
  }) as typeof fetch;
  return { calls, impl };
}

function toolResult(structuredContent: unknown, extra: Record<string, unknown> = {}, sse = false): Response {
  const message = { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "…" }], structuredContent, ...extra } };
  return sse
    ? new Response(`event: message\ndata: ${JSON.stringify(message)}\n\n`, { headers: { "content-type": "text/event-stream" } })
    : Response.json(message);
}

function client(stub: ReturnType<typeof fetchStub>, timeoutMs?: number) {
  return createAgentTrustClient({ endpoint: ENDPOINT, fetch: stub.impl, timeoutMs });
}

describe("checkAgentTrust", () => {
  it("sends one MCP tools/call for check_agent_trust and returns the typed matched result", async () => {
    const stub = fetchStub(toolResult(matched, {}, true));
    const result = await client(stub).checkAgentTrust("https://agent.acme.dev/mcp");

    expect(result).toEqual(matched);
    expect(stub.calls).toHaveLength(1);
    const [call] = stub.calls;
    expect(call.url).toBe(ENDPOINT);
    expect(call.init.method).toBe("POST");
    expect(call.init.headers).toMatchObject({
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      "user-agent": "agenttrust-sdk/0.1.0",
    });
    expect(call.body).toMatchObject({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "check_agent_trust", arguments: { endpointUrl: "https://agent.acme.dev/mcp" } },
    });
    // Never an API key or credential.
    expect(JSON.stringify(call.init.headers)).not.toMatch(/authorization/i);
  });

  it("parses a plain JSON response as well as SSE", async () => {
    const stub = fetchStub(toolResult(matched));
    expect(await client(stub).checkAgentTrust("https://agent.acme.dev/mcp")).toEqual(matched);
  });

  it("returns an unmatched result, with the observation status when present", async () => {
    const stub = fetchStub(
      toolResult({ matched: false }),
      toolResult({ matched: false, observation: { status: "pending", message: "Queued for a registry lookup." } }),
    );
    const c = client(stub);
    expect(await c.checkAgentTrust("https://unknown.acme.dev/mcp")).toEqual({ matched: false });
    expect(await c.checkAgentTrust("https://unknown.acme.dev/mcp")).toEqual({
      matched: false,
      observation: { status: "pending", message: "Queued for a registry lookup." },
    });
  });

  it("ignores fields the server may add later", async () => {
    const stub = fetchStub(toolResult({ ...matched, futureField: 1, trustDecision: { ...matched.trustDecision, extra: true } }));
    expect(await client(stub).checkAgentTrust("https://agent.acme.dev/mcp")).toEqual(matched);
  });

  it.each(["not a url", "agent.acme.dev/mcp", "/mcp", "ftp://agent.acme.dev", "javascript:alert(1)", ""])(
    "rejects %j locally with INVALID_URL and makes no request",
    async (url) => {
      const stub = fetchStub();
      await expect(client(stub).checkAgentTrust(url)).rejects.toMatchObject({ code: "INVALID_URL" });
      expect(stub.calls).toHaveLength(0);
    },
  );

  it("reports AgentTrust's rate limit with retryAfterSeconds, and does not retry on its own", async () => {
    const stub = fetchStub(
      toolResult(
        { error: { code: "RATE_LIMITED", message: "Checking too often — try again in 42s.", details: { retryAfterSeconds: 42 }, retryAfterSeconds: 42 } },
        { isError: true },
      ),
    );
    const error = await client(stub).checkAgentTrust("https://agent.acme.dev/mcp").catch((e) => e);
    expect(error).toBeInstanceOf(AgentTrustError);
    expect(error).toMatchObject({ code: "RATE_LIMITED", retryAfterSeconds: 42 });
    expect(stub.calls).toHaveLength(1);
  });

  it("reports a server-side input rejection as TOOL_ERROR with the server's message", async () => {
    const stub = fetchStub(
      Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: "Input validation error: endpointUrl must be an absolute http:// or https:// URL" }], isError: true },
      }),
    );
    await expect(client(stub).checkAgentTrust("https://agent.acme.dev/mcp")).rejects.toMatchObject({
      code: "TOOL_ERROR",
      message: expect.stringContaining("endpointUrl must be an absolute"),
    });
  });

  it("reports a JSON-RPC error as PROTOCOL_ERROR", async () => {
    const stub = fetchStub(Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" } }));
    await expect(client(stub).checkAgentTrust("https://agent.acme.dev/mcp")).rejects.toMatchObject({
      code: "PROTOCOL_ERROR",
      message: "MCP error: Method not found",
    });
  });

  it.each([402, 500, 503])("reports HTTP %i as HTTP_ERROR with the status", async (status) => {
    const stub = fetchStub(new Response("Payment required", { status }));
    await expect(client(stub).checkAgentTrust("https://agent.acme.dev/mcp")).rejects.toMatchObject({ code: "HTTP_ERROR", status });
  });

  it.each([
    ["not JSON", new Response("<html>", { headers: { "content-type": "text/html" } })],
    ["no result", Response.json({ jsonrpc: "2.0", id: 1 })],
    ["result without matched", toolResult({ slug: "x" })],
    ["incomplete matched result", toolResult({ matched: true, slug: "x" })],
    ["empty SSE stream", new Response("", { headers: { "content-type": "text/event-stream" } })],
  ])("reports %s as PROTOCOL_ERROR", async (_label, response) => {
    await expect(client(fetchStub(response)).checkAgentTrust("https://agent.acme.dev/mcp")).rejects.toMatchObject({
      code: "PROTOCOL_ERROR",
    });
  });

  it("reports a network failure as NETWORK_ERROR", async () => {
    const stub = fetchStub(new TypeError("fetch failed"));
    await expect(client(stub).checkAgentTrust("https://agent.acme.dev/mcp")).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });

  it("times out with TIMEOUT after the configured timeout", async () => {
    const neverAnswers = (async (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })) as typeof fetch;
    const c = createAgentTrustClient({ endpoint: ENDPOINT, fetch: neverAnswers, timeoutMs: 30 });
    const started = Date.now();
    await expect(c.checkAgentTrust("https://agent.acme.dev/mcp")).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("honours a per-call timeout and the caller's abort signal", async () => {
    const neverAnswers = (async (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })) as typeof fetch;
    const c = createAgentTrustClient({ endpoint: ENDPOINT, fetch: neverAnswers, timeoutMs: 60_000 });

    await expect(c.checkAgentTrust("https://agent.acme.dev/mcp", { timeoutMs: 20 })).rejects.toMatchObject({ code: "TIMEOUT" });

    const controller = new AbortController();
    const pending = c.checkAgentTrust("https://agent.acme.dev/mcp", { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "ABORTED" });
  });
});

describe("assertTrusted / evaluatePolicy", () => {
  const notRecommended: MatchedTrustResult = {
    ...matched,
    verified: false,
    reliabilityScore: 40,
    trustDecision: { recommended: false, confidence: "low", reasons: ["Reliability score is low (40/100)."] },
  };
  const stale: MatchedTrustResult = {
    ...matched,
    reliabilityScoreStatus: "stale",
    trustDecision: { recommended: false, confidence: "insufficient_data", reasons: ["Reliability score is out of date."] },
  };

  it("passes a recommended endpoint with the default policy and returns the result", async () => {
    const stub = fetchStub(toolResult(matched));
    await expect(client(stub).assertTrusted("https://agent.acme.dev/mcp")).resolves.toEqual(matched);
  });

  it("throws NotTrustedError, with the result and the failed requirements, for a not-recommended endpoint", async () => {
    const stub = fetchStub(toolResult(notRecommended));
    const error = await client(stub).assertTrusted("https://agent.acme.dev/mcp").catch((e) => e);
    expect(error).toBeInstanceOf(NotTrustedError);
    expect(error.code).toBe("NOT_TRUSTED");
    expect(error.result).toEqual(notRecommended);
    expect(error.failures).toEqual(["not recommended by AgentTrust: Reliability score is low (40/100)."]);
  });

  it("fails closed on an unknown endpoint unless allowUnknown is set", async () => {
    const unknown: TrustCheckResult = { matched: false, observation: { status: "pending", message: "…" } };
    expect(evaluatePolicy(unknown)).toEqual(["AgentTrust has no data for this endpoint (pending)"]);
    expect(evaluatePolicy(unknown, { allowUnknown: true })).toEqual([]);
    const stub = fetchStub(toolResult(unknown));
    await expect(client(stub).assertTrusted("https://unknown.acme.dev/mcp")).rejects.toBeInstanceOf(NotTrustedError);
  });

  it("applies every policy option", () => {
    expect(evaluatePolicy(matched, { minConfidence: "high", requireVerified: true, minReliabilityScore: 90 })).toEqual([]);
    expect(evaluatePolicy({ ...matched, trustDecision: { ...matched.trustDecision, confidence: "medium" } }, { minConfidence: "high" })).toEqual([
      "confidence is medium, below high",
    ]);
    expect(evaluatePolicy({ ...matched, verified: false }, { requireVerified: true })).toEqual(["endpoint ownership is not verified"]);
    expect(evaluatePolicy({ ...matched, reliabilityScore: 70 }, { minReliabilityScore: 80 })).toEqual([
      "reliability score 70 is below 80",
    ]);
    expect(evaluatePolicy(stale, { requireRecommended: false, minReliabilityScore: 50 })).toEqual(["no current reliability score"]);
    expect(evaluatePolicy({ ...matched, reliabilityScore: null, reliabilityScoreStatus: "none" }, { requireRecommended: false, minReliabilityScore: 1 })).toEqual([
      "no current reliability score",
    ]);
    // requireRecommended: false lets a caller apply its own rules instead.
    expect(evaluatePolicy(notRecommended, { requireRecommended: false })).toEqual([]);
  });

  it("fails closed on a confidence value it doesn't recognise", () => {
    const odd = { ...matched, trustDecision: { ...matched.trustDecision, confidence: "experimental" as never } };
    expect(evaluatePolicy(odd, { minConfidence: "low" })).toEqual(["confidence is experimental, below low"]);
  });

  it.each([
    [{ minReliabilityScore: Number.NaN }],
    [{ minReliabilityScore: 101 }],
    [{ minReliabilityScore: -1 }],
    [{ minConfidence: "very-high" as never }],
  ])("rejects an invalid policy %j before making any request", async (policy) => {
    const stub = fetchStub(toolResult(matched));
    await expect(client(stub).assertTrusted("https://agent.acme.dev/mcp", policy)).rejects.toBeInstanceOf(TypeError);
    expect(stub.calls).toHaveLength(0);
  });

  it("calls the global fetch bound to globalThis when no fetch is passed", async () => {
    const original = globalThis.fetch;
    const spy = vi.fn(async () => toolResult(matched));
    globalThis.fetch = spy as unknown as typeof fetch;
    try {
      await createAgentTrustClient({ endpoint: ENDPOINT }).checkAgentTrust("https://agent.acme.dev/mcp");
      expect(spy.mock.contexts[0]).toBe(globalThis);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("propagates check errors (e.g. rate limits) instead of treating them as trusted or untrusted", async () => {
    const stub = fetchStub(new TypeError("fetch failed"));
    const error = await client(stub).assertTrusted("https://agent.acme.dev/mcp").catch((e) => e);
    expect(error).toBeInstanceOf(AgentTrustError);
    expect(error).not.toBeInstanceOf(NotTrustedError);
    expect(error.code).toBe("NETWORK_ERROR");
  });
});
