import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import type { AppDatabase } from "@/lib/db/rls";
import {
  getAgentHealthInputSchema,
  getAgentHealthOutputSchema,
  getAgentInputSchema,
  getAgentOutputSchema,
  listAgentsInputSchema,
  listAgentsOutputSchema,
  mcpGetAgent,
  mcpGetAgentHealth,
  mcpListAgents,
  mcpSendHeartbeat,
  sendHeartbeatInputSchema,
  sendHeartbeatOutputSchema,
} from "./tools";

/**
 * The only SDK-specific code in the MCP adapter: wires each registered
 * tool's parsed input + auth context to the plain, framework-independent
 * functions in `./tools.ts`. No business logic lives here — see that
 * file's header comment for why.
 *
 * `ctx.http?.authInfo?.token` is how the bearer token from the MCP
 * request's `Authorization` header reaches a tool call — see
 * `verifyToken` in `src/app/api/mcp/route.ts` for how it gets there. A
 * missing/invalid/revoked key isn't rejected here; it's passed through
 * unchanged to the reused handler, which rejects it exactly as the REST
 * API would.
 */
export function registerAgentTrustTools(server: McpServer, db: AppDatabase): void {
  server.registerTool(
    "list_agents",
    {
      title: "List Agents",
      description:
        "Discover AgentTrust agents. Pass `endpointUrl` to check the trust status of a specific external agent by its exact invocation URL before deciding whether to invoke it — the response includes a reliability score, endpoint-ownership verification status, and a machine-readable trustDecision (recommended, confidence, reasons). Without `endpointUrl`, returns the plain paginated listing of public agents, newest first.",
      inputSchema: listAgentsInputSchema,
      outputSchema: listAgentsOutputSchema,
    },
    async (input, ctx) => mcpListAgents(db, ctx.http?.authInfo?.token, input),
  );

  server.registerTool(
    "get_agent",
    {
      title: "Get Agent",
      description:
        "Get one AgentTrust agent's public profile by slug, including its structured Agent Card, current reliability score, and a machine-readable trustDecision (recommended, confidence, reasons) for deciding whether to invoke it.",
      inputSchema: getAgentInputSchema,
      outputSchema: getAgentOutputSchema,
    },
    async (input, ctx) => mcpGetAgent(db, ctx.http?.authInfo?.token, input),
  );

  server.registerTool(
    "get_agent_health",
    {
      title: "Get Agent Health",
      description:
        "Get one agent's current effective health status and monitoring detail — derived from heartbeat freshness for push-mode agents, or the latest pull check otherwise.",
      inputSchema: getAgentHealthInputSchema,
      outputSchema: getAgentHealthOutputSchema,
    },
    async (input, ctx) => mcpGetAgentHealth(db, ctx.http?.authInfo?.token, input),
  );

  server.registerTool(
    "send_heartbeat",
    {
      title: "Send Heartbeat",
      description:
        "Record a push-style heartbeat for an agent you own, marking it alive right now. The server sets the timestamp; no client-supplied time is accepted.",
      inputSchema: sendHeartbeatInputSchema,
      outputSchema: sendHeartbeatOutputSchema,
    },
    async (input, ctx) => mcpSendHeartbeat(db, ctx.http?.authInfo?.token, input),
  );
}
