import {
  readRequestBody,
  type McpServerOptions,
} from "@modelcontextprotocol/server";

/**
 * Bounds on what one MCP request may carry, for both MCP routes
 * (GHSA-46jr-4wx8-v453: one request within the SDK's 4 MiB default could
 * exhaust server memory during validation). Real requests are a few KB,
 * and the largest tool input (`list_agents`) has three arguments.
 */
export const MCP_MAX_REQUEST_BODY_BYTES = 64 * 1024;

/** Array elements plus object members allowed in one `tools/call`'s arguments. */
export const MCP_MAX_TOOL_INPUT_ELEMENTS = 100;

/**
 * `McpServer` options for both routes, spread into `createMcpHandler`'s
 * options. mcp-handler passes every option it doesn't use itself on to
 * `new McpServer(...)`, but its options type lists only `ServerOptions`, so
 * the limit is typed here (route tests check it is enforced).
 */
export const MCP_SERVER_LIMITS: Pick<McpServerOptions, "maxToolInputElements"> =
  {
    maxToolInputElements: MCP_MAX_TOOL_INPUT_ELEMENTS,
  };

/**
 * Wraps an MCP route handler so a POST body over
 * `MCP_MAX_REQUEST_BODY_BYTES` is refused with 413 before anything parses
 * it — the same response the SDK's own transport gives. It has to happen
 * here: mcp-handler parses the body itself and hands the SDK the parsed
 * result, and the SDK skips its size limit when given a parsed body.
 * Other methods pass through untouched.
 */
export function withMcpRequestLimit(
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== "POST") return handler(req);
    const body = await readRequestBody(req, MCP_MAX_REQUEST_BODY_BYTES);
    if (body.tooLarge) {
      return Response.json(
        {
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: `Payload Too Large: Request body must not exceed ${MCP_MAX_REQUEST_BODY_BYTES} bytes`,
          },
          id: null,
        },
        { status: 413 },
      );
    }
    // The original body has been read; hand on a copy with the same text
    // and headers (client IP for rate limiting, Authorization, etc.).
    return handler(new Request(req, { body: body.text }));
  };
}
