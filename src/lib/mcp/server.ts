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
import {
  assessAgentInputSchema,
  assessAgentOutputSchema,
  mcpAssessAgent,
  type AssessAgentInput,
} from "./assess-agent-tool";

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
        "Discover AgentTrust agents. Pass `endpointUrl` to check the trust status of a specific external agent by its exact invocation URL before deciding whether to invoke it — the response includes a reliability score, endpoint-ownership verification status, and a machine-readable trustDecision (recommended, confidence, reasons). Without `endpointUrl`, returns the plain paginated listing of public agents, newest first. Requires an API key; for an anonymous pre-invocation check use check_agent_trust.",
      inputSchema: listAgentsInputSchema,
      outputSchema: listAgentsOutputSchema,
      annotations: readOnlyAnnotations("List Agents"),
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
      annotations: readOnlyAnnotations("Get Agent"),
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
      annotations: readOnlyAnnotations("Get Agent Health"),
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
      annotations: SEND_HEARTBEAT_ANNOTATIONS,
    },
    async (input, ctx) => mcpSendHeartbeat(db, ctx.http?.authInfo?.token, input),
  );

  server.registerTool(
    "check_agent_trust",
    {
      title: "Check Agent Trust",
      description:
        "Pre-invocation trust check for an unknown AI agent or MCP server endpoint. Read-only, requires no AgentTrust API key or account. Looks up an agent by its exact invocation URL among AgentTrust's already-observed public agents and returns its status, endpoint-ownership verification, agent reliability score (when available), and a machine-readable trustDecision (recommended, confidence, reasons). Does NOT contact endpointUrl itself during this check — it only reads AgentTrust's own existing monitoring history. An unregistered URL returns { matched: false }, never an error.",
      inputSchema: checkAgentTrustInputSchema,
      outputSchema: checkAgentTrustOutputSchema,
      annotations: CHECK_AGENT_TRUST_ANNOTATIONS,
    },
    checkAgentTrustHandler(db),
  );

  server.registerTool(
    "assess_agent",
    {
      title: "Assess Agent",
      description:
        "Immediate use-or-avoid decision about an AI agent or MCP server endpoint, for an agent deciding whether to call it. Returns decision (allow_with_caution, avoid, or insufficient_evidence), confidence, reasonCodes, reachability (the latest stored observation, with its age), initialRisk, the historical reliability score and trustDecision (unchanged), limitations, and freshness. Built only from AgentTrust's stored observations: it never contacts endpointUrl. Reachability is not safety: allow_with_caution never means the agent's behavior is safe. Requires no API key.",
      inputSchema: assessAgentInputSchema,
      outputSchema: assessAgentOutputSchema,
      annotations: ASSESS_AGENT_ANNOTATIONS,
    },
    assessAgentHandler(db, "mcp"),
  );
}

/**
 * `assess_agent`'s annotations, the same on both endpoints: in this phase
 * it only reads AgentTrust's stored data and never contacts endpointUrl.
 */
const ASSESS_AGENT_ANNOTATIONS = {
  title: "Assess Agent",
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** The `assess_agent` callback; like `check_agent_trust`, it rate-limits by the real request's caller IP. */
function assessAgentHandler(db: AppDatabase, surface: "mcp" | "mcp_public") {
  return async (input: AssessAgentInput, ctx: { http?: { req?: Request } }) =>
    mcpAssessAgent(db, ctx.http?.req ?? new Request("https://mcp.internal/assess-agent"), input, surface);
}

/**
 * Annotations for the API-key tools that only read AgentTrust's own stored
 * data: they never write it (beyond the auth layer's rate-limit and
 * key-usage bookkeeping) and never contact an agent's endpoint.
 */
function readOnlyAnnotations(title: string) {
  return {
    title,
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  } as const;
}

/**
 * `send_heartbeat` writes: each call moves the agent's `lastHeartbeatAt`
 * forward and adds a push health check and a reliability score, so it's
 * neither read-only nor idempotent. It deletes nothing, and it only
 * touches AgentTrust's own data.
 */
const SEND_HEARTBEAT_ANNOTATIONS = {
  title: "Send Heartbeat",
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

/**
 * `check_agent_trust`'s tool annotations, the same on both endpoints: it
 * only reads AgentTrust's own stored data and never contacts endpointUrl.
 */
const CHECK_AGENT_TRUST_ANNOTATIONS = {
  title: "Check Agent Trust",
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

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
  "AgentTrust offers two read-only tools for checking an unknown AI agent or MCP server before calling it. check_agent_trust looks up the endpoint's exact URL in AgentTrust's own monitoring data and returns the agent's observed status, endpoint-ownership verification, reliability score (when available), and a trustDecision (recommended, confidence, reasons). assess_agent returns a use-or-avoid decision (allow_with_caution, avoid, or insufficient_evidence) with reason codes, evidence, limitations, and freshness. Results are signals derived from AgentTrust's observations, not a certification or guarantee of safety; reachability is not evidence of safe behavior. Neither tool contacts the endpoint being checked.";

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
 * The public connector endpoint's trust check: the same `check_agent_trust`
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
      annotations: CHECK_AGENT_TRUST_ANNOTATIONS,
    },
    checkAgentTrustHandler(db),
  );
}

/**
 * The public connector's `assess_agent`: the same assessment, output schema
 * and handler as `/api/mcp`, with a neutral description and the same
 * stricter URL validation as the public `check_agent_trust`. No API key.
 */
export function registerPublicAssessAgentTool(server: McpServer, db: AppDatabase): void {
  server.registerTool(
    "assess_agent",
    {
      title: "Assess Agent",
      description:
        "Use-or-avoid decision about an AI agent or MCP server endpoint, built from AgentTrust's stored observations of its exact URL. Returns decision (allow_with_caution, avoid, or insufficient_evidence), confidence, reasonCodes, reachability (the latest stored observation, with its age), initialRisk, the historical reliability score and trustDecision, limitations, and freshness. Read-only, no account or API key. It never contacts endpointUrl. Reachability is not safety: allow_with_caution does not mean the agent's behavior is safe. A URL AgentTrust has not observed returns decision insufficient_evidence.",
      inputSchema: assessAgentInputSchema.extend({
        endpointUrl: assessAgentInputSchema.shape.endpointUrl.refine(isHttpUrl, {
          error: "endpointUrl must be an absolute http:// or https:// URL, such as https://agent.example.com/invoke.",
        }),
      }),
      outputSchema: assessAgentOutputSchema,
      annotations: ASSESS_AGENT_ANNOTATIONS,
    },
    assessAgentHandler(db, "mcp_public"),
  );
}
