import "server-only";
import {
  checkAgentEndpoint,
  type FetchOutcome,
  type CheckStatus,
} from "./safe-fetch";
import { withRetry } from "./retry";

/**
 * Only network-level failures where no response was ever received are
 * worth retrying — a blip is exactly what a retry is meant to smooth over.
 * Everything else is a *definitive* answer already: an HTTP response (even
 * a 5xx) means the agent is there and said something; ssrf_blocked and
 * tls_error are deterministic — the same URL will fail the same way on
 * a second attempt, so retrying just adds load for no chance of a
 * different outcome.
 */
const RETRYABLE_STATUSES: ReadonlySet<CheckStatus> = new Set([
  "timeout",
  "dns_error",
  "connection_error",
]);

export type HealthCheckResult = FetchOutcome & { attempts: number };

/** The health-check runner's one entry point: check an agent's endpoint, retrying only what's safe to retry. */
export async function checkAgentHealth(
  url: string,
): Promise<HealthCheckResult> {
  const { result, attempts } = await withRetry(
    () => checkAgentEndpoint(url),
    (outcome) => RETRYABLE_STATUSES.has(outcome.status),
  );
  return { ...result, attempts };
}
