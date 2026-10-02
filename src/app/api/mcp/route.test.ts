import { beforeAll, describe, expect, it, vi } from "vitest";
import { INITIALIZE_PARAMS, mcpRpc } from "@/lib/test/mcp-http";

// The route imports the app's `db`; point it at an in-memory PGlite
// database so these HTTP-level tests never reach a real one.
vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("@/lib/db/test-harness");
  return { db: (await createTestDb()).db };
});

const URL_MCP = "https://getagenttrust.com/api/mcp";
let post: (req: Request) => Promise<Response>;

beforeAll(async () => {
  post = (await import("./route")).POST;
});

/**
 * Regression guard for `/api/mcp`, the endpoint every existing listing
 * (official MCP Registry, Smithery, Glama, directories) points at: its
 * initialize result and full tool list — names, titles, descriptions,
 * schemas, and the absence of annotations — are pinned to a snapshot, so
 * any change to them has to be deliberate.
 */
describe("/api/mcp (unchanged)", () => {
  it("initialize result matches the pinned snapshot (serverInfo agenttrust 1.0.3, instructions)", async () => {
    const { status, body } = await mcpRpc(post, URL_MCP, {
      id: 1,
      method: "initialize",
      params: INITIALIZE_PARAMS,
    });
    expect(status).toBe(200);
    const result = body.result as { serverInfo: unknown };
    expect(result.serverInfo).toEqual({ name: "agenttrust", version: "1.0.3" });
    await expect(JSON.stringify(result, null, 2)).toMatchFileSnapshot("./__snapshots__/initialize.json");
  });

  it("tools/list matches the pinned snapshot: the same five tools, no annotations", async () => {
    const { body } = await mcpRpc(post, URL_MCP, { id: 2, method: "tools/list" });
    const tools = (body.result as { tools: { name: string; annotations?: unknown }[] }).tools;
    expect(tools.map((tool) => tool.name)).toEqual([
      "list_agents",
      "get_agent",
      "get_agent_health",
      "send_heartbeat",
      "check_agent_trust",
    ]);
    expect(tools.some((tool) => tool.annotations !== undefined)).toBe(false);
    await expect(JSON.stringify(body.result, null, 2)).toMatchFileSnapshot("./__snapshots__/tools-list.json");
  });

  it("still rejects an API-key tool called without a key, as before", async () => {
    const { status, body } = await mcpRpc(post, URL_MCP, {
      id: 3,
      method: "tools/call",
      params: { name: "list_agents", arguments: {} },
    });
    expect(status).toBe(200);
    const result = body.result as { isError?: boolean; structuredContent?: { error?: { code?: string } } };
    expect(result.isError).toBe(true);
    expect(result.structuredContent?.error?.code).toBe("UNAUTHENTICATED");
  });

  it("still answers check_agent_trust anonymously", async () => {
    const { body } = await mcpRpc(
      post,
      URL_MCP,
      {
        id: 4,
        method: "tools/call",
        params: { name: "check_agent_trust", arguments: { endpointUrl: "https://never-registered.example.com/x" } },
      },
      { "x-vercel-forwarded-for": "198.51.100.40" },
    );
    const result = body.result as { isError?: boolean; structuredContent?: unknown };
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ matched: false });
  });
});
