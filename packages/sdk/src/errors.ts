import type { TrustCheckResult } from "./types.js";

export type AgentTrustErrorCode =
  /** The URL isn't an absolute http:// or https:// URL; no request was made. */
  | "INVALID_URL"
  /** AgentTrust's anonymous rate limit was reached; see `retryAfterSeconds`. */
  | "RATE_LIMITED"
  /** The request didn't finish within the timeout. */
  | "TIMEOUT"
  /** The request was aborted by the caller's signal. */
  | "ABORTED"
  /** The request couldn't reach AgentTrust. */
  | "NETWORK_ERROR"
  /** AgentTrust answered with a non-2xx HTTP status; see `status`. */
  | "HTTP_ERROR"
  /** The response wasn't a valid MCP / check_agent_trust result. */
  | "PROTOCOL_ERROR"
  /** The tool reported an error (for example, input the server rejected). */
  | "TOOL_ERROR"
  /** `assertTrusted`: the endpoint didn't meet the policy; see `failures`. */
  | "NOT_TRUSTED";

export class AgentTrustError extends Error {
  readonly code: AgentTrustErrorCode;
  readonly status?: number;
  readonly retryAfterSeconds?: number;

  constructor(
    code: AgentTrustErrorCode,
    message: string,
    options: { status?: number; retryAfterSeconds?: number; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AgentTrustError";
    this.code = code;
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

/** Thrown by `assertTrusted` when the trust check succeeded but the endpoint didn't meet the policy. */
export class NotTrustedError extends AgentTrustError {
  /** The full trust-check result the decision was based on. */
  readonly result: TrustCheckResult;
  /** Every policy requirement the endpoint failed, in plain language. */
  readonly failures: string[];

  constructor(result: TrustCheckResult, failures: string[]) {
    super("NOT_TRUSTED", `Endpoint not trusted: ${failures.join("; ")}`);
    this.name = "NotTrustedError";
    this.result = result;
    this.failures = failures;
  }
}
