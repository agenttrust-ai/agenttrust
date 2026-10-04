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
 * schemas, and annotations — are pinned to a snapshot, so any change to
 * them has to be deliberate.
 */
describe("/api/mcp", () => {
  it("initialize result matches the pinned snapshot (serverInfo agenttrust 1.0.4, instructions)", async () => {
    const { status, body } = await mcpRpc(post, URL_MCP, {
      id: 1,
      method: "initialize",
      params: INITIALIZE_PARAMS,
    });
    expect(status).toBe(200);
    const result = body.result as { serverInfo: unknown };
    expect(result.serverInfo).toEqual({ name: "agenttrust", version: "1.0.4" });
    await expect(JSON.stringify(result, null, 2)).toMatchFileSnapshot("./__snapshots__/initialize.json");
  });

  it("tools/list matches the pinned snapshot: the same five tools, annotations only on check_agent_trust", async () => {
    const { body } = await mcpRpc(post, URL_MCP, { id: 2, method: "tools/list" });
    const tools = (body.result as { tools: { name: string; description?: string; annotations?: unknown }[] }).tools;
    expect(tools.map((tool) => tool.name)).toEqual([
      "list_agents",
      "get_agent",
      "get_agent_health",
      "send_heartbeat",
      "check_agent_trust",
    ]);
    expect(tools.filter((tool) => tool.annotations !== undefined).map((tool) => tool.name)).toEqual([
      "check_agent_trust",
    ]);
    await expect(JSON.stringify(body.result, null, 2)).toMatchFileSnapshot("./__snapshots__/tools-list.json");
  });

  it("describes check_agent_trust like /api/mcp/public, and points list_agents callers without a key to it", async () => {
    const { body } = await mcpRpc(post, URL_MCP, { id: 5, method: "tools/list" });
    const tools = (body.result as { tools: { name: string; description: string; annotations?: unknown }[] }).tools;
    const check = tools.find((tool) => tool.name === "check_agent_trust")!;
    expect(check.description).toMatch(/^Pre-invocation trust check for an unknown AI agent or MCP server endpoint\./);
    expect(check.description).not.toMatch(/preferred/i);
    expect(check.annotations).toEqual({
      title: "Check Agent Trust",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    const list = tools.find((tool) => tool.name === "list_agents")!;
    expect(list.description).toMatch(/Requires an API key; for an anonymous pre-invocation check use check_agent_trust\.$/);
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
