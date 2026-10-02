/**
 * Test helper: sends one JSON-RPC message to an MCP route handler exactly
 * as a Streamable HTTP client would, and returns the parsed JSON-RPC
 * response (unwrapping a text/event-stream body if the server streams).
 */
export async function mcpRpc(
  handler: (req: Request) => Promise<Response>,
  url: string,
  message: { id: number; method: string; params?: unknown },
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await handler(
    new Request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", params: {}, ...message }),
    }),
  );
  const text = await res.text();
  const json = res.headers.get("content-type")?.includes("text/event-stream")
    ? text
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice("data: ".length))
        .join("")
    : text;
  return { status: res.status, body: JSON.parse(json) as Record<string, unknown> };
}

export const INITIALIZE_PARAMS = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "agenttrust-test", version: "0" },
};
