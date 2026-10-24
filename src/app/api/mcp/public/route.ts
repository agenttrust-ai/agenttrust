import { createMcpHandler } from "mcp-handler";
import { db } from "@/lib/db";
import { PUBLIC_CONNECTOR_INSTRUCTIONS, registerPublicTrustCheckTool } from "@/lib/mcp/server";
import {
  MCP_SERVER_LIMITS,
  withMcpRequestLimit,
} from "@/lib/mcp/request-limits";

export const dynamic = "force-dynamic";

// Every MCP request here answers in well under a second; this only bounds
// a request that would otherwise hold a function (and its memory) open.
export const maxDuration = 30;

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
    // Refuse `subscriptions/listen` at once (a JSON-RPC error, no SSE
    // stream). The tool list never changes at runtime, so a listen stream
    // would never carry a notification — it only kept a function open,
    // up to ~10 minutes per client connection.
    maxSubscriptions: 0,
    instructions: PUBLIC_CONNECTOR_INSTRUCTIONS,
    // Bounds tool-call arguments; the body size is bounded below.
    ...MCP_SERVER_LIMITS,
  },
);

const limitedHandler = withMcpRequestLimit(handler);

export { limitedHandler as GET, limitedHandler as POST };
