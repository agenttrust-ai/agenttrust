/**
 * The anonymous rate limit, as /docs and /llms.txt describe it. Kept out of
 * page.tsx (a page module can't export anything else) so
 * src/lib/discovery/doc-accuracy.test.ts can check these numbers against
 * src/lib/api/anonymous-rate-limit.ts and src/lib/rate-limit/config.ts.
 * Backticks mark code.
 */

export const ANONYMOUS_LIMIT = { perIp: 10, global: 300, windowSeconds: 60 };
export const KEYED_LIMIT = { perKey: 100, windowSeconds: 60 };

export const ANONYMOUS_LIMIT_TEXT = `Anonymous (no API key): \`check_agent_trust\` and \`assess_agent\` share one limit, counted in fixed ${ANONYMOUS_LIMIT.windowSeconds}-second windows: ${ANONYMOUS_LIMIT.perIp} checks per caller IP address, and ${ANONYMOUS_LIMIT.global} across all anonymous callers combined. It applies to both tools on \`/api/mcp/public\` and on \`/api/mcp\` (even when an API key is sent), and to the browser checker at \`/check-agent-trust\`.`;

export const ANONYMOUS_LIMIT_OVER_TEXT =
  "Over the limit, the HTTP response is still 200: the tool returns an error result (`isError: true`) whose `structuredContent.error` has the code `RATE_LIMITED` and `retryAfterSeconds`. The SDK reports it as an `AgentTrustError` with the code `RATE_LIMITED` and never retries on its own. A call whose IP address can't be determined is refused the same way.";

export const KEYED_LIMIT_LABEL = "With an API key (REST `/api/v1/*`):";
