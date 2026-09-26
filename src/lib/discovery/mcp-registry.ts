import "server-only";

const MCP_REGISTRY_BASE_URL = "https://registry.modelcontextprotocol.io";
const FETCH_TIMEOUT_MS = 10_000;

/**
 * The subset of the official MCP Registry's server object
 * (https://registry.modelcontextprotocol.io/openapi.yaml, GET /v0/servers)
 * this app actually reads. `remotes` is the registry's own documented field
 * for a server's live invocation endpoints — never inferred from its
 * repository, package name, or description.
 */
export type McpRegistryRemote = {
  type: string;
  url?: string;
};

export type McpRegistryServer = {
  /** Reverse-DNS server identifier, e.g. "io.github.user/weather" — stable across versions. */
  name: string;
  title?: string;
  description?: string;
  version: string;
  remotes?: McpRegistryRemote[];
};

export type McpRegistryEntry = {
  server: McpRegistryServer;
  /** From `_meta["io.modelcontextprotocol.registry/official"].status` — the registry's own moderation signal. */
  status: string;
};

export class McpRegistryFetchError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
    /** The HTTP status, when the registry answered with a non-2xx response. */
    readonly status?: number,
  ) {
    super(message);
    this.name = "McpRegistryFetchError";
  }
}

export type McpRegistryPage = {
  entries: McpRegistryEntry[];
  /**
   * The registry's own `metadata.nextCursor` — pass it back as `cursor` to
   * read the following page. `null` means this was the last page.
   */
  nextCursor: string | null;
};

/**
 * One bounded, unauthenticated read of one page of the official MCP
 * Registry's public server list — never more than `limit` servers, one
 * request per call, no crawling of individual server pages or their
 * repositories. `version=latest` asks the registry itself to return only
 * each server's current published version (confirmed live: the response's
 * own `_meta.isLatest` is `true` for every row when this param is set).
 *
 * `cursor` is opaque: only ever a value this registry previously returned
 * as `metadata.nextCursor` (keyset pagination — confirmed live), never
 * constructed here.
 *
 * Fails closed: a network error, a non-2xx response, or an unexpected body
 * shape all throw `McpRegistryFetchError` rather than returning a partial
 * or guessed result — a caller must treat that as "the import didn't run
 * this time", not as "zero servers are available."
 */
export async function fetchMcpRegistryServers(
  limit: number,
  cursor?: string,
): Promise<McpRegistryPage> {
  const params = new URLSearchParams({ limit: String(limit), version: "latest" });
  if (cursor) params.set("cursor", cursor);
  const url = `${MCP_REGISTRY_BASE_URL}/v0/servers?${params.toString()}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
  } catch (error) {
    throw new McpRegistryFetchError("Couldn't reach the MCP Registry.", error);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new McpRegistryFetchError(
      `MCP Registry returned HTTP ${response.status}.`,
      undefined,
      response.status,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new McpRegistryFetchError(
      "MCP Registry returned a response that wasn't valid JSON.",
      error,
    );
  }

  const serversField = (body as { servers?: unknown } | null)?.servers;
  if (!Array.isArray(serversField)) {
    throw new McpRegistryFetchError("MCP Registry response was in an unexpected shape.");
  }

  const entries: McpRegistryEntry[] = [];
  for (const raw of serversField) {
    if (typeof raw !== "object" || raw === null) continue;
    const server = (raw as { server?: unknown }).server;
    if (
      typeof server !== "object" ||
      server === null ||
      typeof (server as { name?: unknown }).name !== "string" ||
      typeof (server as { version?: unknown }).version !== "string"
    ) {
      continue;
    }

    const meta = (raw as { _meta?: Record<string, unknown> })._meta;
    const officialMeta = meta?.["io.modelcontextprotocol.registry/official"] as
      | { status?: unknown }
      | undefined;
    const status = typeof officialMeta?.status === "string" ? officialMeta.status : "unknown";

    entries.push({ server: server as McpRegistryServer, status });
  }

  const rawNextCursor = (body as { metadata?: { nextCursor?: unknown } })
    .metadata?.nextCursor;
  const nextCursor =
    typeof rawNextCursor === "string" && rawNextCursor.length > 0
      ? rawNextCursor
      : null;

  return { entries, nextCursor };
}
