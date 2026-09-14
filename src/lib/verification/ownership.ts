import "server-only";
import { randomBytes } from "node:crypto";

/**
 * Fixed, origin-relative well-known path — the same domain-verification
 * convention used by ACME/Let's Encrypt (HTTP-01) and Google Search
 * Console: the owner proves control of the endpoint's origin by publishing
 * a value AgentTrust gave them at a predictable, unauthenticated URL.
 */
export const WELL_KNOWN_VERIFICATION_PATH = "/.well-known/agenttrust-verification.txt";

/**
 * Minimum time between "Check now" attempts for the same agent, whether or
 * not the previous attempt succeeded. This is what stands between an
 * authenticated account and unlimited outbound requests to an arbitrary
 * HTTPS URL through AgentTrust's own servers — the same 60-second window
 * already used for the Public API's own rate limit
 * (`RATE_LIMIT_WINDOW_SECONDS`), reused here for consistency rather than
 * inventing a second, differently-sized window.
 */
export const OWNERSHIP_CHECK_COOLDOWN_SECONDS = 60;

/**
 * A cryptographically random domain-ownership challenge value. Unlike an
 * `agent-credentials.ts` credential, this is *not* a secret AgentTrust must
 * protect — it's meant to be published by the owner on their own public web
 * server, and staying published after a successful check is fine (there's
 * nothing to rotate). It still must never appear in any *public-facing*
 * AgentTrust surface (public API, Agent Card, MCP output): the trust signal
 * other systems should read is the boolean/timestamp *result* of the check,
 * never the challenge value itself.
 */
export function generateVerificationToken(): string {
  return randomBytes(24).toString("hex");
}

/** Where AgentTrust expects to find the token for a given agent endpoint — always the origin's well-known path, never the endpoint's own invocation path. */
export function buildVerificationUrl(endpointUrl: string): string {
  return new URL(WELL_KNOWN_VERIFICATION_PATH, new URL(endpointUrl).origin).toString();
}

/**
 * Only an exact match (after trimming incidental surrounding whitespace —
 * text files routinely end in a trailing newline) counts as success. Plain
 * string comparison, not constant-time: unlike a password or API key, an
 * attacker able to observe response-time differences here would first need
 * to control DNS/hosting for the claimed origin, at which point they could
 * simply serve the right value instead of timing-attacking it — constant-
 * time comparison defends against a threat model that doesn't apply to a
 * domain-ownership challenge.
 */
export function tokenMatches(receivedBody: string, expectedToken: string): boolean {
  return receivedBody.trim() === expectedToken;
}
