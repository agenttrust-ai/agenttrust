import { createMcpHandler } from "mcp-handler";
import { db } from "@/lib/db";
import { PUBLIC_CONNECTOR_INSTRUCTIONS, registerPublicTrustCheckTool } from "@/lib/mcp/server";

export const dynamic = "force-dynamic";

/**
 * Public connector endpoint for MCP directories that list servers with no
 * authentication (e.g. Claude's Connectors Directory): exposes only the
 * anonymous, read-only `check_agent_trust` tool. The same check, schemas,
 * rate limiting and telemetry as `/api/mcp`, which is unchanged and still
 * serves the API-key tools. Nothing here reads an Authorization header.
 */
const handler = createMcpHandler(
  (server) => {
    registerPublicTrustCheckTool(server, db);
  },
  {
    serverInfo: { name: "agenttrust", version: "1.0.4" },
    instructions: PUBLIC_CONNECTOR_INSTRUCTIONS,
  },
);

export { handler as GET, handler as POST };
