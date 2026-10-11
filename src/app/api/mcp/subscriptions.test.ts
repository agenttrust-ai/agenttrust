import { beforeAll, describe, expect, it, vi } from "vitest";

// Both routes import the app's `db`; point it at an in-memory PGlite
// database so these HTTP-level tests never reach a real one.
vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("@/lib/db/test-harness");
  return { db: (await createTestDb()).db };
});

/**
 * Long-lived `subscriptions/listen` streams (protocol revision 2026-07-28)
 * held Vercel functions open for up to ~10 minutes each. AgentTrust's tool
 * list never changes at runtime, so a listen stream would never carry a
 * notification: both MCP routes refuse it at once, without opening a stream.
 * Everything else a modern client does — tools/list, tools/call — still works.
 */

const MODERN_REVISION = "2026-07-28";
const MODERN_META = {
  "io.modelcontextprotocol/protocolVersion": MODERN_REVISION,
  "io.modelcontextprotocol/clientInfo": { name: "agenttrust-test", version: "0" },
  "io.modelcontextprotocol/clientCapabilities": {},
};

type Route = { name: string; url: string; module: { POST: (req: Request) => Promise<Response>; maxDuration?: number } };
const routes: Route[] = [];

beforeAll(async () => {
  routes.push(
    { name: "/api/mcp", url: "https://getagenttrust.com/api/mcp", module: await import("./route") },
    { name: "/api/mcp/public", url: "https://getagenttrust.com/api/mcp/public", module: await import("./public/route") },
  );
});

function modernRequest(url: string, id: number, method: string, params: Record<string, unknown>, extraHeaders: Record<string, string> = {}) {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": MODERN_REVISION,
      "mcp-method": method,
      "x-vercel-forwarded-for": "198.51.100.77",
      ...extraHeaders,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params: { ...params, _meta: MODERN_META } }),
  });
}

/** Reads the whole body if it ends within `ms`; otherwise cancels it and reports that it stayed open. */
async function readWithin(res: Response, ms: number): Promise<{ text: string; stayedOpen: boolean }> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + ms;
  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      await reader.cancel();
      return { text, stayedOpen: true };
    }
    const chunk = await Promise.race([
      reader.read(),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), remaining)),
    ]);
    if (chunk === "timeout") {
      await reader.cancel();
      return { text, stayedOpen: true };
    }
    if (chunk.done) return { text, stayedOpen: false };
    text += decoder.decode(chunk.value, { stream: true });
  }
}

function jsonRpcBody(text: string, contentType: string | null): Record<string, unknown> {
  const json = contentType?.includes("text/event-stream")
    ? text
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice("data: ".length))
        .at(-1)!
    : text;
  return JSON.parse(json) as Record<string, unknown>;
}

describe.each(["/api/mcp", "/api/mcp/public"])("%s — subscriptions/listen", (routeName) => {
  const route = () => routes.find((r) => r.name === routeName)!;

  it("refuses subscriptions/listen immediately with a JSON-RPC error, without opening a stream", async () => {
    const res = await route().module.POST(
      modernRequest(route().url, 1, "subscriptions/listen", { notifications: { toolsListChanged: true } }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).not.toContain("text/event-stream");
    const { text, stayedOpen } = await readWithin(res, 1_000);
    expect(stayedOpen).toBe(false);
    expect(jsonRpcBody(text, res.headers.get("content-type"))).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32603, message: "Subscription limit reached" },
    });
  });

  it("stays cheap if a client keeps retrying: every attempt is refused at once, none stays open", async () => {
    const started = Date.now();
    for (let id = 1; id <= 5; id++) {
      const res = await route().module.POST(
        modernRequest(route().url, id, "subscriptions/listen", { notifications: { toolsListChanged: true } }),
      );
      const { stayedOpen } = await readWithin(res, 1_000);
      expect(stayedOpen).toBe(false);
    }
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("still serves a modern client's tools/list and tools/call", async () => {
    const list = await route().module.POST(modernRequest(route().url, 2, "tools/list", {}));
    const listText = await readWithin(list, 5_000);
    expect(listText.stayedOpen).toBe(false);
    const listBody = jsonRpcBody(listText.text, list.headers.get("content-type"));
    const names = ((listBody.result as { tools: { name: string }[] }).tools).map((tool) => tool.name);
    expect(names).toContain("check_agent_trust");

    const call = await route().module.POST(
      modernRequest(
        route().url,
        3,
        "tools/call",
        { name: "check_agent_trust", arguments: { endpointUrl: "https://never-registered.example.com/x" } },
        { "mcp-name": "check_agent_trust" },
      ),
    );
    const callText = await readWithin(call, 5_000);
    expect(callText.stayedOpen).toBe(false);
    const callBody = jsonRpcBody(callText.text, call.headers.get("content-type"));
    expect((callBody.result as { structuredContent: unknown }).structuredContent).toEqual({ matched: false });
  });

  it("caps the function at 30 seconds", () => {
    expect(route().module.maxDuration).toBe(30);
  });
});
