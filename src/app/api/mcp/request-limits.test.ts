import { beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { INITIALIZE_PARAMS, mcpRpc } from "@/lib/test/mcp-http";
import {
  MCP_MAX_REQUEST_BODY_BYTES,
  MCP_MAX_TOOL_INPUT_ELEMENTS,
} from "@/lib/mcp/request-limits";

// Both routes import the app's `db`; point it at an in-memory PGlite
// database so these HTTP-level tests never reach a real one.
const harness = vi.hoisted(() => ({ client: null as unknown as PGlite }));
vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("@/lib/db/test-harness");
  const created = await createTestDb();
  harness.client = created.client;
  return { db: created.db };
});

type Handler = (req: Request) => Promise<Response>;
const routes: { name: string; url: string; GET: Handler; POST: Handler }[] = [];

beforeAll(async () => {
  const main = await import("./route");
  const pub = await import("./public/route");
  routes.push(
    { name: "/api/mcp", url: "https://getagenttrust.com/api/mcp", ...main },
    {
      name: "/api/mcp/public",
      url: "https://getagenttrust.com/api/mcp/public",
      ...pub,
    },
  );
});

const HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

/** A syntactically valid JSON-RPC message padded to `bytes` bytes. */
function paddedMessage(bytes: number): string {
  const base = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: { _meta: { pad: "" } },
  });
  return base.replace('"pad":""', `"pad":"${"x".repeat(bytes - base.length)}"`);
}

const PAYLOAD_TOO_LARGE = {
  jsonrpc: "2.0",
  error: {
    code: -32000,
    message: `Payload Too Large: Request body must not exceed ${MCP_MAX_REQUEST_BODY_BYTES} bytes`,
  },
  id: null,
};

async function trustCheckEvents(): Promise<number> {
  const { rows } = await harness.client.query<{ n: number }>(
    "select count(*)::int as n from trust_check_events",
  );
  return rows[0].n;
}

describe("MCP request body limit (both routes)", () => {
  it("refuses a body over the limit with 413, by declared Content-Length", async () => {
    for (const route of routes) {
      const body = paddedMessage(MCP_MAX_REQUEST_BODY_BYTES + 1);
      const res = await route.POST(
        new Request(route.url, { method: "POST", headers: HEADERS, body }),
      );
      expect(res.status, route.name).toBe(413);
      expect(await res.json(), route.name).toEqual(PAYLOAD_TOO_LARGE);
    }
  });

  it("refuses an oversized streamed body with no Content-Length", async () => {
    for (const route of routes) {
      const chunk = new TextEncoder().encode("x".repeat(16 * 1024));
      let sent = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent > MCP_MAX_REQUEST_BODY_BYTES) return controller.close();
          sent += chunk.byteLength;
          controller.enqueue(chunk);
        },
      });
      const req = new Request(route.url, {
        method: "POST",
        headers: HEADERS,
        body: stream,
        duplex: "half",
      } as RequestInit);
      expect(req.headers.get("content-length")).toBeNull();
      const res = await route.POST(req);
      expect(res.status, route.name).toBe(413);
      expect(await res.json(), route.name).toEqual(PAYLOAD_TOO_LARGE);
    }
  });

  it("accepts a body exactly at the limit", async () => {
    for (const route of routes) {
      const body = paddedMessage(MCP_MAX_REQUEST_BODY_BYTES);
      expect(new TextEncoder().encode(body).byteLength).toBe(
        MCP_MAX_REQUEST_BODY_BYTES,
      );
      const res = await route.POST(
        new Request(route.url, { method: "POST", headers: HEADERS, body }),
      );
      expect(res.status, route.name).toBe(200);
    }
  });

  it("leaves GET handling unchanged (405)", async () => {
    for (const route of routes) {
      const res = await route.GET(
        new Request(route.url, {
          method: "GET",
          headers: { accept: "text/event-stream" },
        }),
      );
      expect(res.status, route.name).toBe(405);
    }
  });
});

describe("MCP tool input limit (both routes)", () => {
  const tooManyArgs = () => {
    const args: Record<string, unknown> = {
      endpointUrl: "https://unknown-agent.example.com/mcp",
    };
    for (let i = 0; i < MCP_MAX_TOOL_INPUT_ELEMENTS; i++) args[`extra${i}`] = i;
    return args;
  };

  it("refuses check_agent_trust arguments over the limit, before any lookup or telemetry", async () => {
    for (const route of routes) {
      const before = await trustCheckEvents();
      const { status, body } = await mcpRpc(route.POST, route.url, {
        id: 2,
        method: "tools/call",
        params: { name: "check_agent_trust", arguments: tooManyArgs() },
      });
      expect(status, route.name).toBe(200);
      expect(body.result, route.name).toEqual({
        content: [
          {
            type: "text",
            text: `Invalid arguments for tool check_agent_trust: arguments contain more than the maximum of ${MCP_MAX_TOOL_INPUT_ELEMENTS} elements`,
          },
        ],
        isError: true,
      });
      expect(await trustCheckEvents(), route.name).toBe(before);
    }
  });

  it("still runs a normal check_agent_trust call", async () => {
    for (const route of routes) {
      const { body } = await mcpRpc(
        route.POST,
        route.url,
        {
          id: 3,
          method: "tools/call",
          params: {
            name: "check_agent_trust",
            arguments: { endpointUrl: "https://unknown-agent.example.com/mcp" },
          },
        },
        { "x-vercel-forwarded-for": `203.0.113.${routes.indexOf(route) + 10}` },
      );
      const result = body.result as {
        isError?: boolean;
        structuredContent?: { matched?: boolean };
      };
      expect(result.isError ?? false, route.name).toBe(false);
      expect(result.structuredContent?.matched, route.name).toBe(false);
    }
  });
});

describe("one server per request (MCP SDK 2.3+)", () => {
  it("answers requests that reuse the same JSON-RPC id, in turn and at once", async () => {
    for (const route of routes) {
      const initialize = () =>
        mcpRpc(route.POST, route.url, {
          id: 0,
          method: "initialize",
          params: INITIALIZE_PARAMS,
        });
      const list = () =>
        mcpRpc(route.POST, route.url, { id: 0, method: "tools/list" });

      for (const call of [initialize, list, initialize, list]) {
        const { status, body } = await call();
        expect(status, route.name).toBe(200);
        expect(body.id, route.name).toBe(0);
        expect(body.error, route.name).toBeUndefined();
      }

      const [a, b, c] = await Promise.all([initialize(), list(), list()]);
      expect((a.body.result as { serverInfo: unknown }).serverInfo).toEqual({
        name: "agenttrust",
        version: "1.0.4",
      });
      for (const res of [b, c]) {
        expect(
          Array.isArray((res.body.result as { tools: unknown[] }).tools),
          route.name,
        ).toBe(true);
      }
    }
  });
});
