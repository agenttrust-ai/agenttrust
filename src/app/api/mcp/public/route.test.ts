import { beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { AppDatabase } from "@/lib/db/rls";
import { seedUser } from "@/lib/db/test-harness";
import { createAgent } from "@/lib/db/queries/agents";
import { ANONYMOUS_RATE_LIMIT_PER_IP } from "@/lib/api/anonymous-rate-limit";
import { PUBLIC_CONNECTOR_INSTRUCTIONS } from "@/lib/mcp/server";
import { INITIALIZE_PARAMS, mcpRpc } from "@/lib/test/mcp-http";

// Both routes import the app's `db`; point it at an in-memory PGlite
// database so these HTTP-level tests never reach a real one.
const harness = vi.hoisted(() => ({ client: null as unknown as PGlite, db: null as unknown as AppDatabase }));
vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("@/lib/db/test-harness");
  const created = await createTestDb();
  harness.client = created.client;
  harness.db = created.db;
  return { db: created.db };
});

const PUBLIC_URL = "https://getagenttrust.com/api/mcp/public";
const KEYED_TOOLS = ["list_agents", "get_agent", "get_agent_health", "send_heartbeat"];
const owner = "33333333-3333-3333-3333-333333333333";

let publicPost: (req: Request) => Promise<Response>;
let mainPost: (req: Request) => Promise<Response>;

beforeAll(async () => {
  publicPost = (await import("./route")).POST;
  mainPost = (await import("../route")).POST;
});

function fromIp(ip: string) {
  return { "x-vercel-forwarded-for": ip };
}

type Tool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: Record<string, unknown>;
};

async function listTools(post: (req: Request) => Promise<Response>, url: string): Promise<Tool[]> {
  const { body } = await mcpRpc(post, url, { id: 1, method: "tools/list" });
  return (body.result as { tools: Tool[] }).tools;
}

async function callTool(name: string, args: unknown, headers: Record<string, string>) {
  const { status, body } = await mcpRpc(
    publicPost,
    PUBLIC_URL,
    { id: 2, method: "tools/call", params: { name, arguments: args } },
    headers,
  );
  return { status, body, result: body.result as { isError?: boolean; structuredContent?: Record<string, unknown> } | undefined };
}

describe("/api/mcp/public", () => {
  it("initializes with no Authorization header, with neutral, non-directive instructions", async () => {
    const { status, body } = await mcpRpc(publicPost, PUBLIC_URL, {
      id: 1,
      method: "initialize",
      params: INITIALIZE_PARAMS,
    });
    expect(status).toBe(200);
    const result = body.result as { serverInfo: unknown; instructions: string };
    expect(result.serverInfo).toEqual({ name: "agenttrust", version: "1.0.4" });
    expect(result.instructions).toBe(PUBLIC_CONNECTOR_INSTRUCTIONS);
    for (const directive of [/only proceed/i, /before invoking/i, /preferred/i, /\bcall check_agent_trust\b/i]) {
      expect(result.instructions).not.toMatch(directive);
    }
  });

  it("lists exactly one tool, check_agent_trust, with the required annotations", async () => {
    const tools = await listTools(publicPost, PUBLIC_URL);
    expect(tools.map((tool) => tool.name)).toEqual(["check_agent_trust"]);

    const [tool] = tools;
    expect(tool.title).toBe("Check Agent Trust");
    expect(tool.annotations).toEqual({
      title: "Check Agent Trust",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(tool.description).not.toMatch(/preferred/i);
  });

  it("states when the tool applies — an unknown AI agent or MCP server, before calling it — in the description and instructions", async () => {
    const [tool] = await listTools(publicPost, PUBLIC_URL);
    expect(tool.description).toMatch(/^Pre-invocation trust check for an unknown AI agent or MCP server endpoint\./);
    expect(tool.description).toMatch(/exact URL you are about to call as endpointUrl/);
    expect(tool.description).toMatch(/never contacts endpointUrl/);
    expect(PUBLIC_CONNECTOR_INSTRUCTIONS).toMatch(/for checking an unknown AI agent or MCP server before calling it\./);
  });

  it("uses exactly the same input and output schemas as /api/mcp's check_agent_trust", async () => {
    const [publicTool] = await listTools(publicPost, PUBLIC_URL);
    const mainTool = (await listTools(mainPost, "https://getagenttrust.com/api/mcp")).find(
      (tool) => tool.name === "check_agent_trust",
    )!;
    expect(publicTool.inputSchema).toEqual(mainTool.inputSchema);
    expect(publicTool.outputSchema).toEqual(mainTool.outputSchema);
  });

  it("checks an unknown URL anonymously and returns { matched: false }", async () => {
    const { status, result } = await callTool(
      "check_agent_trust",
      { endpointUrl: "https://never-registered.example.com/v1/invoke" },
      fromIp("198.51.100.10"),
    );
    expect(status).toBe(200);
    expect(result?.isError).toBeFalsy();
    expect(result?.structuredContent).toEqual({ matched: false });
  });

  it("returns the same trust result as /api/mcp for a known public, active agent", async () => {
    await seedUser(harness.client, owner, "owner@example.com");
    const agent = await createAgent(harness.db, owner, {
      name: "Public Connector Bot",
      description: "Answers questions.",
      endpointUrl: "https://public-connector.example.com/v1/invoke",
      version: "1.0.0",
      capabilities: ["chat"],
      authType: "none",
    });
    await harness.client.query(
      `update public.agents set lifecycle_status = 'active', visibility = 'public' where id = $1`,
      [agent.id],
    );

    const args = { endpointUrl: "https://public-connector.example.com/v1/invoke" };
    const viaPublic = await callTool("check_agent_trust", args, fromIp("198.51.100.11"));
    const viaMain = await mcpRpc(
      mainPost,
      "https://getagenttrust.com/api/mcp",
      { id: 3, method: "tools/call", params: { name: "check_agent_trust", arguments: args } },
      fromIp("198.51.100.12"),
    );

    expect(viaPublic.result?.isError).toBeFalsy();
    expect(viaPublic.result?.structuredContent).toMatchObject({ matched: true, slug: agent.slug });
    expect(viaPublic.result?.structuredContent).toHaveProperty("trustDecision");
    expect(viaPublic.result?.structuredContent).toEqual(
      (viaMain.body.result as { structuredContent: unknown }).structuredContent,
    );
  });

  it("ignores an Authorization header: the check runs the same with or without one", async () => {
    const { result } = await callTool(
      "check_agent_trust",
      { endpointUrl: "https://never-registered.example.com/v1/invoke" },
      { ...fromIp("198.51.100.13"), authorization: "Bearer not-a-real-key" },
    );
    expect(result?.isError).toBeFalsy();
    expect(result?.structuredContent).toEqual({ matched: false });
  });

  it.each(KEYED_TOOLS)("does not expose the API-key tool %s, even with a bearer token", async (name) => {
    const { body, result } = await callTool(
      name,
      { slug: "anything", endpointUrl: "https://x.example.com" },
      { ...fromIp("198.51.100.14"), authorization: "Bearer not-a-real-key" },
    );
    // Unknown tool: a JSON-RPC error, or an error result naming the tool —
    // never a successful call.
    if (body.error) {
      expect(JSON.stringify(body.error)).toMatch(new RegExp(name));
    } else {
      expect(result?.isError).toBe(true);
      expect(JSON.stringify(result)).toMatch(/not found/i);
    }
    expect(result?.structuredContent).toBeUndefined();
  });

  it.each([
    "not a url",
    "agent.example.com/v1/invoke",
    "/v1/invoke",
    "ftp://files.example.com/agent",
    "mailto:agent@example.com",
    "javascript:alert(1)",
  ])("rejects a malformed endpointUrl (%s) with an actionable error, not { matched: false }", async (endpointUrl) => {
    const { body, result } = await callTool("check_agent_trust", { endpointUrl }, fromIp("198.51.100.16"));
    const error = JSON.stringify(body.error ?? result);
    if (!body.error) expect(result?.isError).toBe(true);
    expect(error).toContain("endpointUrl must be an absolute http:// or https:// URL");
    expect(result?.structuredContent).not.toEqual({ matched: false });
  });

  it("accepts a plain http:// URL as well as https://", async () => {
    const { result } = await callTool(
      "check_agent_trust",
      { endpointUrl: "http://never-registered.example.com/v1/invoke" },
      fromIp("198.51.100.17"),
    );
    expect(result?.isError).toBeFalsy();
    expect(result?.structuredContent).toEqual({ matched: false });
  });

  it("rejects malformed input before the rate limiter: it uses up none of the caller's allowance", async () => {
    const ip = fromIp("198.51.100.18");
    for (let i = 0; i < ANONYMOUS_RATE_LIMIT_PER_IP + 1; i++) {
      await callTool("check_agent_trust", { endpointUrl: "not a url" }, ip);
    }
    const { result } = await callTool(
      "check_agent_trust",
      { endpointUrl: "https://never-registered.example.com/v1/invoke" },
      ip,
    );
    expect(result?.isError).toBeFalsy();
    expect(result?.structuredContent).toEqual({ matched: false });
  });

  it("keeps the anonymous per-IP rate limit", async () => {
    const ip = fromIp("198.51.100.15");
    const args = { endpointUrl: "https://never-registered.example.com/v1/invoke" };
    for (let i = 0; i < ANONYMOUS_RATE_LIMIT_PER_IP; i++) {
      const { result } = await callTool("check_agent_trust", args, ip);
      expect(result?.isError).toBeFalsy();
    }
    const { result } = await callTool("check_agent_trust", args, ip);
    expect(result?.isError).toBe(true);
    expect(JSON.stringify(result)).toMatch(/RATE_LIMITED/);
    expect(JSON.stringify(result)).toMatch(/retryAfterSeconds/);
  });
});
