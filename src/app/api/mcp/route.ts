import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { db } from "@/lib/db";
import { registerAgentTrustTools } from "@/lib/mcp/server";

export const dynamic = "force-dynamic";

/**
 * Pure plumbing, not a gate: `withMcpAuth` already extracts the bearer
 * token from the `Authorization` header before calling this, so all this
 * does is carry that token forward into `ctx.http.authInfo.token` for a
 * tool call to read (see src/lib/mcp/server.ts). It never calls
 * `verifyApiKey` and never rejects anything — real authentication,
 * ownership, and rate limiting all happen exactly once, inside the same
 * `handle*` functions the REST API uses, when a tool actually executes.
 * Discovery (`initialize`, `tools/list`) never reaches a tool body, so it
 * always succeeds regardless of whether a key was even sent.
 */
function verifyToken(_req: Request, bearerToken?: string): AuthInfo {
  return { token: bearerToken ?? "", clientId: "agenttrust-mcp", scopes: [] };
}

const handler = createMcpHandler(
  (server) => {
    registerAgentTrustTools(server, db);
  },
  {
    serverInfo: { name: "agenttrust", version: "1.0.2" },
    // Sent to every client during initialize — the standard MCP mechanism
    // for "how to use this server", read once up front rather than
    // inferred solely from individual tool descriptions.
    instructions:
      "AgentTrust is trust infrastructure for AI agents. Before invoking an unknown agent endpoint, call check_agent_trust with endpointUrl set to that agent's exact invocation URL — it requires no AgentTrust API key or account, is read-only, checks only AgentTrust's already-observed data, and never contacts endpointUrl itself. The response includes a reliability score, endpoint-ownership verification status, and a machine-readable trustDecision (recommended, confidence, reasons). Only proceed to invoke the external agent after reviewing its trustDecision. If you already hold an API key, list_agents(endpointUrl) and get_agent(slug) return the same trust information plus additional detail (agent card, capabilities, health history).",
  },
);

const authedHandler = withMcpAuth(handler, verifyToken, { required: false });

export { authedHandler as GET, authedHandler as POST };
