import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMcpRegistryServers, McpRegistryFetchError } from "./mcp-registry";

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

function registryEntry(overrides: {
  name?: string;
  version?: string;
  title?: string;
  description?: string;
  remotes?: { type: string; url?: string }[];
  status?: string;
}) {
  return {
    server: {
      name: overrides.name ?? "io.github.example/agent",
      title: overrides.title,
      description: overrides.description,
      version: overrides.version ?? "1.0.0",
      remotes: overrides.remotes ?? [
        { type: "streamable-http", url: "https://api.example.com/mcp" },
      ],
    },
    _meta: {
      "io.modelcontextprotocol.registry/official": {
        status: overrides.status ?? "active",
        isLatest: true,
      },
    },
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchMcpRegistryServers", () => {
  it("parses a well-formed response into entries with server + status", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        servers: [registryEntry({ name: "io.github.example/agent", status: "active" })],
        metadata: { count: 1 },
      }),
    );

    const entries = await fetchMcpRegistryServers(50);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.server.name).toBe("io.github.example/agent");
    expect(entries[0]!.status).toBe("active");
    expect(entries[0]!.server.remotes).toEqual([
      { type: "streamable-http", url: "https://api.example.com/mcp" },
    ]);
  });

  it("requests version=latest and the given limit, never more than one request", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ servers: [] }));
    await fetchMcpRegistryServers(25);

    expect(fetchMock).toHaveBeenCalledOnce();
    const requestedUrl = String(fetchMock.mock.calls[0]![0]);
    expect(requestedUrl).toContain("registry.modelcontextprotocol.io/v0/servers");
    expect(requestedUrl).toContain("limit=25");
    expect(requestedUrl).toContain("version=latest");
  });

  it("defaults status to 'unknown' when _meta is missing", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        servers: [{ server: { name: "io.github.example/no-meta", version: "1.0.0" } }],
      }),
    );
    const entries = await fetchMcpRegistryServers(50);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.status).toBe("unknown");
  });

  it("skips a malformed entry (missing server.name) without throwing, keeping the valid ones", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        servers: [
          { server: { version: "1.0.0" } }, // missing name
          registryEntry({ name: "io.github.example/valid" }),
          { server: null },
          "not-even-an-object",
        ],
      }),
    );
    const entries = await fetchMcpRegistryServers(50);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.server.name).toBe("io.github.example/valid");
  });

  it("throws McpRegistryFetchError on a non-2xx HTTP status", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "boom" }, { status: 503 }));
    await expect(fetchMcpRegistryServers(50)).rejects.toBeInstanceOf(McpRegistryFetchError);
  });

  it("throws McpRegistryFetchError when the response body isn't valid JSON", async () => {
    fetchMock.mockResolvedValue(
      new Response("not json", { status: 200, headers: { "content-type": "text/plain" } }),
    );
    await expect(fetchMcpRegistryServers(50)).rejects.toBeInstanceOf(McpRegistryFetchError);
  });

  it("throws McpRegistryFetchError when the response shape is unexpected (no servers array)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ notServers: [] }));
    await expect(fetchMcpRegistryServers(50)).rejects.toBeInstanceOf(McpRegistryFetchError);
  });

  it("throws McpRegistryFetchError on a network error", async () => {
    fetchMock.mockRejectedValue(new TypeError("network down"));
    await expect(fetchMcpRegistryServers(50)).rejects.toBeInstanceOf(McpRegistryFetchError);
  });
});
