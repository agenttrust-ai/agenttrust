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
  { serverInfo: { name: "agenttrust", version: "1.0.0" } },
);

const authedHandler = withMcpAuth(handler, verifyToken, { required: false });

export { authedHandler as GET, authedHandler as POST };
