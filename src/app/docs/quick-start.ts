import { SDK_EXAMPLE_ENDPOINT } from "./sdk-reference";

/**
 * The no-account Quick Start options on /docs. Kept out of page.tsx (a page
 * module can't export anything else) so tests can check them: the curl
 * example is rendered from MCP_CURL_REQUEST, which
 * src/app/api/mcp/public/sdk-contract.test.ts sends to the real route.
 */

/** The public MCP connector: Streamable HTTP, no authentication, only check_agent_trust. */
export const PUBLIC_MCP_URL = "https://getagenttrust.com/api/mcp/public";

/** Claude Code's documented syntax for a remote HTTP server: `claude mcp add --transport http <name> <url>`. */
export const CLAUDE_CODE_ADD_COMMAND = `claude mcp add --transport http agenttrust ${PUBLIC_MCP_URL}`;

/** One anonymous, read-only check_agent_trust call over plain HTTP. */
export const MCP_CURL_REQUEST = {
  url: PUBLIC_MCP_URL,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  },
  body: {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "check_agent_trust",
      arguments: { endpointUrl: SDK_EXAMPLE_ENDPOINT },
    },
  },
} as const;

export const MCP_CURL_EXAMPLE = [
  `curl -s ${MCP_CURL_REQUEST.url} \\`,
  ...Object.entries(MCP_CURL_REQUEST.headers).map(
    ([name, value]) => `  -H "${name}: ${value}" \\`,
  ),
  `  -d '${JSON.stringify(MCP_CURL_REQUEST.body)}'`,
].join("\n");

/** The browser checker, prefilled with the example endpoint (as on the home page). */
export const BROWSER_CHECK_URL = `/check-agent-trust?endpointUrl=${encodeURIComponent(SDK_EXAMPLE_ENDPOINT)}`;
