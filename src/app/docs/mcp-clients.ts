import { CLAUDE_CODE_ADD_COMMAND, PUBLIC_MCP_URL } from "./quick-start";

/**
 * MCP client setup shown on /docs (#mcp-clients) and in public/llms.txt.
 * Kept out of page.tsx (a page module can't export anything else) so tests
 * can check the page and llms.txt against the same strings. Syntax follows
 * each client's own documentation (OFFICIAL_SETUP_DOCS).
 */

export { CLAUDE_CODE_ADD_COMMAND, PUBLIC_MCP_URL };

/** The full MCP server: every tool except check_agent_trust needs an API key. */
export const AUTHENTICATED_MCP_URL = "https://getagenttrust.com/api/mcp";

/** Never a real key: the docs only ever show this placeholder. */
export const API_KEY_PLACEHOLDER = "<API_KEY>";

export const CLAUDE_DIRECTORY_URL = "https://claude.ai/directory/agenttrust";

export const OFFICIAL_SETUP_DOCS = {
  claudeCode: "https://code.claude.com/docs/en/mcp",
  claude:
    "https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp",
  cursor: "https://cursor.com/docs/context/mcp",
} as const;

/** Cursor: `mcpServers` → name → `url` (remote servers need no other field). */
export const CURSOR_CONFIG = {
  mcpServers: { agenttrust: { url: PUBLIC_MCP_URL } },
} as const;
export const CURSOR_CONFIG_JSON = JSON.stringify(CURSOR_CONFIG, null, 2);

export const CLAUDE_CODE_ADD_AUTHENTICATED_COMMAND = `claude mcp add --transport http agenttrust-account ${AUTHENTICATED_MCP_URL} --header "Authorization: Bearer ${API_KEY_PLACEHOLDER}"`;

export const CURSOR_AUTHENTICATED_CONFIG = {
  mcpServers: {
    "agenttrust-account": {
      url: AUTHENTICATED_MCP_URL,
      headers: { Authorization: `Bearer ${API_KEY_PLACEHOLDER}` },
    },
  },
} as const;
export const CURSOR_AUTHENTICATED_CONFIG_JSON = JSON.stringify(
  CURSOR_AUTHENTICATED_CONFIG,
  null,
  2,
);
