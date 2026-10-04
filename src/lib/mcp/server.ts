import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import type { AppDatabase } from "@/lib/db/rls";
import {
  checkAgentTrustInputSchema,
  checkAgentTrustOutputSchema,
  getAgentHealthInputSchema,
  getAgentHealthOutputSchema,
  getAgentInputSchema,
  getAgentOutputSchema,
  listAgentsInputSchema,
  listAgentsOutputSchema,
  mcpCheckAgentTrust,
  mcpGetAgent,
  mcpGetAgentHealth,
  mcpListAgents,
  mcpSendHeartbeat,
  sendHeartbeatInputSchema,
  sendHeartbeatOutputSchema,
  type CheckAgentTrustInput,
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

  server.registerTool(
    "check_agent_trust",
    {
      title: "Check Agent Trust",
      description:
        "The preferred pre-invocation trust check for an unknown external agent. Read-only, requires no AgentTrust API key or account. Looks up an agent by its exact invocation URL among AgentTrust's already-observed public agents and returns its status, endpoint-ownership verification, agent reliability score (when available), and a machine-readable trustDecision (recommended, confidence, reasons). Does NOT contact endpointUrl itself during this check — it only reads AgentTrust's own existing monitoring history. An unregistered URL returns { matched: false }, never an error.",
      inputSchema: checkAgentTrustInputSchema,
      outputSchema: checkAgentTrustOutputSchema,
    },
    checkAgentTrustHandler(db),
  );
}

/**
 * The one `check_agent_trust` tool callback, shared by `/api/mcp` and the
 * public connector endpoint so both run the identical check.
 *
 * ctx.http.req is the *real* inbound request (unlike every other tool
 * here, which only ever needs the bearer token off it) -- this tool
 * rate-limits by caller IP instead of by API key, since it has no key
 * to key on. If a transport ever hands this tool a context with no
 * `req` at all, fall back to a header-less Request: the rate limiter's
 * own IP extraction already fails closed on missing IP signal, so this
 * never silently becomes "unlimited".
 */
function checkAgentTrustHandler(db: AppDatabase) {
  return async (input: CheckAgentTrustInput, ctx: { http?: { req?: Request } }) =>
    mcpCheckAgentTrust(db, ctx.http?.req ?? new Request("https://mcp.internal/check-agent-trust"), input);
}

/**
 * Server instructions for the public connector endpoint (`/api/mcp/public`):
 * what the server offers, stated as fact — no directions to the client.
 */
export const PUBLIC_CONNECTOR_INSTRUCTIONS =
  "AgentTrust offers one read-only tool, check_agent_trust, for checking an unknown AI agent or MCP server before calling it. It looks up the endpoint's exact URL in AgentTrust's own monitoring data and returns the agent's observed status, endpoint-ownership verification, reliability score (when available), and a trustDecision (recommended, confidence, reasons). The result is a signal derived from AgentTrust's observations, not a certification or guarantee of safety. The tool never contacts the endpoint being checked.";

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * The public tool's input: the same schema `/api/mcp` advertises, plus a
 * check that `endpointUrl` is an absolute http(s) URL, so a malformed
 * value gets an actionable error instead of `{ matched: false }`. The
 * extra check doesn't change the advertised JSON Schema, and it runs
 * before the tool does, so a rejected call never touches the rate limiter
 * or telemetry.
 */
const publicCheckAgentTrustInputSchema = checkAgentTrustInputSchema.extend({
  endpointUrl: checkAgentTrustInputSchema.shape.endpointUrl.refine(isHttpUrl, {
    error: "endpointUrl must be an absolute http:// or https:// URL, such as https://agent.example.com/invoke.",
  }),
});

/**
 * The public connector endpoint's only tool: the same `check_agent_trust`
 * check, output schema and handler as `/api/mcp`, with a neutral
 * description, stricter input validation, and the tool annotations
 * directory listings (e.g. Claude's) require. Needs no API key, so this
 * endpoint needs no authentication at all.
 */
export function registerPublicTrustCheckTool(server: McpServer, db: AppDatabase): void {
  server.registerTool(
    "check_agent_trust",
    {
      title: "Check Agent Trust",
      description:
        "Pre-invocation trust check for an unknown AI agent or MCP server endpoint. Pass the exact URL you are about to call as endpointUrl to get what AgentTrust has observed about it: status, endpoint-ownership verification, reliability score (when available), and a trustDecision (recommended, confidence, reasons). Read-only, no account or API key. It never contacts endpointUrl; it only reads AgentTrust's stored monitoring history. A URL AgentTrust has not observed returns { matched: false }.",
      inputSchema: publicCheckAgentTrustInputSchema,
      outputSchema: checkAgentTrustOutputSchema,
      annotations: {
        title: "Check Agent Trust",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    checkAgentTrustHandler(db),
  );
}
