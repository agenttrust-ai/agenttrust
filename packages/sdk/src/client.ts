import { AgentTrustError, NotTrustedError } from "./errors.js";
import type {
  AgentTrustClientOptions,
  CheckOptions,
  MatchedTrustResult,
  TrustCheckResult,
  TrustPolicy,
  UnmatchedTrustResult,
} from "./types.js";

export const SDK_VERSION = "0.1.0";
export const DEFAULT_ENDPOINT = "https://getagenttrust.com/api/mcp/public";
export const DEFAULT_TIMEOUT_MS = 10_000;
/** The MCP protocol revision this client speaks (stateless Streamable HTTP). */
const MCP_PROTOCOL_VERSION = "2025-06-18";

const CONFIDENCE_RANK: Record<string, number> = { insufficient_data: 0, low: 1, medium: 2, high: 3 };
/** An unexpected confidence value ranks lowest, so a `minConfidence` check fails closed. */
function confidenceRank(confidence: string): number {
  return CONFIDENCE_RANK[confidence] ?? 0;
}

/** Throws on a policy that can't be applied as written, instead of silently ignoring it. */
function validatePolicy(policy: TrustPolicy): void {
  if (policy.minConfidence !== undefined && !["low", "medium", "high"].includes(policy.minConfidence)) {
    throw new TypeError('policy.minConfidence must be "low", "medium" or "high".');
  }
  const min = policy.minReliabilityScore;
  if (min !== undefined && !(typeof min === "number" && Number.isFinite(min) && min >= 0 && min <= 100)) {
    throw new TypeError("policy.minReliabilityScore must be a number from 0 to 100.");
  }
}

export interface AgentTrustClient {
  /** Looks up what AgentTrust has observed about the exact endpoint URL you are about to call. Never contacts that URL. */
  checkAgentTrust(endpointUrl: string, options?: CheckOptions): Promise<TrustCheckResult>;
  /**
   * Checks the endpoint and throws `NotTrustedError` unless it meets the
   * policy. Returns the result it decided on. Fails closed: an unknown
   * endpoint is rejected unless `policy.allowUnknown` is set.
   */
  assertTrusted(
    endpointUrl: string,
    policy?: TrustPolicy,
    options?: CheckOptions,
  ): Promise<TrustCheckResult>;
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The JSON-RPC message in a response body: plain JSON, or the last `data:` event of an SSE stream. */
function parseRpcBody(text: string, contentType: string | null): unknown {
  const json = contentType?.includes("text/event-stream")
    ? text
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trim())
        .filter(Boolean)
        .at(-1)
    : text;
  if (json === undefined) throw new Error("empty response");
  return JSON.parse(json);
}

/** Validates the parts of a result callers rely on; extra fields are ignored. */
function toTrustCheckResult(value: unknown): TrustCheckResult {
  if (!isRecord(value) || typeof value.matched !== "boolean") {
    throw new AgentTrustError("PROTOCOL_ERROR", "check_agent_trust returned an unexpected result.");
  }
  if (!value.matched) {
    const result: UnmatchedTrustResult = { matched: false };
    const observation = value.observation;
    if (isRecord(observation) && typeof observation.status === "string" && typeof observation.message === "string") {
      result.observation = {
        status: observation.status as NonNullable<UnmatchedTrustResult["observation"]>["status"],
        message: observation.message,
      };
    }
    return result;
  }
  const decision = value.trustDecision;
  if (
    typeof value.slug !== "string" ||
    typeof value.name !== "string" ||
    typeof value.status !== "string" ||
    typeof value.verified !== "boolean" ||
    !(typeof value.reliabilityScore === "number" || value.reliabilityScore === null) ||
    typeof value.reliabilityScoreStatus !== "string" ||
    !isRecord(decision) ||
    typeof decision.recommended !== "boolean" ||
    typeof decision.confidence !== "string" ||
    !Array.isArray(decision.reasons)
  ) {
    throw new AgentTrustError("PROTOCOL_ERROR", "check_agent_trust returned an incomplete matched result.");
  }
  return {
    matched: true,
    slug: value.slug,
    name: value.name,
    status: value.status as MatchedTrustResult["status"],
    verified: value.verified,
    reliabilityScore: value.reliabilityScore,
    reliabilityScoreStatus: value.reliabilityScoreStatus as MatchedTrustResult["reliabilityScoreStatus"],
    trustDecision: {
      recommended: decision.recommended,
      confidence: decision.confidence as MatchedTrustResult["trustDecision"]["confidence"],
      reasons: decision.reasons.map(String),
    },
  };
}

/** Turns an MCP tool error into a typed error. */
function toolError(result: Record<string, unknown>): AgentTrustError {
  const structured = isRecord(result.structuredContent) ? result.structuredContent.error : undefined;
  if (isRecord(structured)) {
    const message = typeof structured.message === "string" ? structured.message : "check_agent_trust failed.";
    if (structured.code === "RATE_LIMITED") {
      const details = isRecord(structured.details) ? structured.details : {};
      const retryAfter = Number(structured.retryAfterSeconds ?? details.retryAfterSeconds);
      return new AgentTrustError("RATE_LIMITED", message, {
        retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : undefined,
      });
    }
    return new AgentTrustError("TOOL_ERROR", message);
  }
  const text = Array.isArray(result.content)
    ? result.content
        .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
        .join(" ")
        .trim()
    : "";
  return new AgentTrustError("TOOL_ERROR", text || "check_agent_trust failed.");
}

/** The policy requirements a result fails, in plain language. Empty means it passes. */
export function evaluatePolicy(result: TrustCheckResult, policy: TrustPolicy = {}): string[] {
  validatePolicy(policy);
  if (!result.matched) {
    if (policy.allowUnknown) return [];
    const observation = result.observation ? ` (${result.observation.status})` : "";
    return [`AgentTrust has no data for this endpoint${observation}`];
  }

  const failures: string[] = [];
  const decision = result.trustDecision;
  if ((policy.requireRecommended ?? true) && !decision.recommended) {
    failures.push(
      `not recommended by AgentTrust${decision.reasons.length ? `: ${decision.reasons.join(" ")}` : ""}`,
    );
  }
  if (policy.minConfidence && confidenceRank(decision.confidence) < confidenceRank(policy.minConfidence)) {
    failures.push(`confidence is ${decision.confidence}, below ${policy.minConfidence}`);
  }
  if (policy.requireVerified && !result.verified) {
    failures.push("endpoint ownership is not verified");
  }
  if (policy.minReliabilityScore !== undefined) {
    if (result.reliabilityScore === null || result.reliabilityScoreStatus !== "fresh") {
      failures.push("no current reliability score");
    } else if (result.reliabilityScore < policy.minReliabilityScore) {
      failures.push(`reliability score ${result.reliabilityScore} is below ${policy.minReliabilityScore}`);
    }
  }
  return failures;
}

export function createAgentTrustClient(options: AgentTrustClientOptions = {}): AgentTrustClient {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const defaultTimeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const userAgent = options.userAgent ?? `agenttrust-sdk/${SDK_VERSION}`;
  let nextId = 1;

  async function checkAgentTrust(endpointUrl: string, check: CheckOptions = {}): Promise<TrustCheckResult> {
    if (typeof endpointUrl !== "string" || !isHttpUrl(endpointUrl.trim())) {
      throw new AgentTrustError(
        "INVALID_URL",
        "endpointUrl must be an absolute http:// or https:// URL, such as https://agent.example.com/mcp.",
      );
    }
    // The global fetch is called through globalThis: some runtimes throw
    // "Illegal invocation" when it's called detached.
    const fetchImpl: typeof fetch | undefined =
      options.fetch ??
      (typeof globalThis.fetch === "function" ? (input, init) => globalThis.fetch(input, init) : undefined);
    if (typeof fetchImpl !== "function") {
      throw new AgentTrustError("NETWORK_ERROR", "No fetch implementation is available; pass one in the client options.");
    }

    const timeoutMs = check.timeoutMs ?? defaultTimeout;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort();
    if (check.signal?.aborted) controller.abort();
    else check.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            "mcp-protocol-version": MCP_PROTOCOL_VERSION,
            "user-agent": userAgent,
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: nextId++,
            method: "tools/call",
            params: { name: "check_agent_trust", arguments: { endpointUrl: endpointUrl.trim() } },
          }),
        });
      } catch (error) {
        if (timedOut) throw new AgentTrustError("TIMEOUT", `AgentTrust didn't answer within ${timeoutMs} ms.`, { cause: error });
        if (controller.signal.aborted) throw new AgentTrustError("ABORTED", "The trust check was aborted.", { cause: error });
        throw new AgentTrustError("NETWORK_ERROR", "Couldn't reach AgentTrust.", { cause: error });
      }

      let text: string;
      try {
        text = await response.text();
      } catch (error) {
        if (timedOut) throw new AgentTrustError("TIMEOUT", `AgentTrust didn't answer within ${timeoutMs} ms.`, { cause: error });
        throw new AgentTrustError("NETWORK_ERROR", "The response from AgentTrust was interrupted.", { cause: error });
      }

      if (!response.ok) {
        throw new AgentTrustError("HTTP_ERROR", `AgentTrust responded with HTTP ${response.status}.`, {
          status: response.status,
        });
      }

      let message: unknown;
      try {
        message = parseRpcBody(text, response.headers.get("content-type"));
      } catch (error) {
        throw new AgentTrustError("PROTOCOL_ERROR", "AgentTrust returned a response that isn't valid JSON-RPC.", { cause: error });
      }
      if (!isRecord(message)) {
        throw new AgentTrustError("PROTOCOL_ERROR", "AgentTrust returned a response that isn't valid JSON-RPC.");
      }
      if (isRecord(message.error)) {
        const rpcMessage = typeof message.error.message === "string" ? message.error.message : "unknown error";
        throw new AgentTrustError("PROTOCOL_ERROR", `MCP error: ${rpcMessage}`);
      }
      const result = message.result;
      if (!isRecord(result)) {
        throw new AgentTrustError("PROTOCOL_ERROR", "AgentTrust returned no tool result.");
      }
      if (result.isError === true) throw toolError(result);
      return toTrustCheckResult(result.structuredContent);
    } finally {
      clearTimeout(timer);
      check.signal?.removeEventListener("abort", onAbort);
    }
  }

  async function assertTrusted(
    endpointUrl: string,
    policy: TrustPolicy = {},
    check: CheckOptions = {},
  ): Promise<TrustCheckResult> {
    validatePolicy(policy); // before any request: a bad policy is a programming error
    const result = await checkAgentTrust(endpointUrl, check);
    const failures = evaluatePolicy(result, policy);
    if (failures.length > 0) throw new NotTrustedError(result, failures);
    return result;
  }

  return { checkAgentTrust, assertTrusted };
}

let defaultClient: AgentTrustClient | undefined;
function getDefaultClient(): AgentTrustClient {
  defaultClient ??= createAgentTrustClient();
  return defaultClient;
}

/** `checkAgentTrust` with the default client (public endpoint, 10 s timeout). */
export function checkAgentTrust(endpointUrl: string, options?: CheckOptions): Promise<TrustCheckResult> {
  return getDefaultClient().checkAgentTrust(endpointUrl, options);
}

/** `assertTrusted` with the default client (public endpoint, 10 s timeout). */
export function assertTrusted(
  endpointUrl: string,
  policy?: TrustPolicy,
  options?: CheckOptions,
): Promise<TrustCheckResult> {
  return getDefaultClient().assertTrusted(endpointUrl, policy, options);
}
