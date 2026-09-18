import "server-only";

const A2A_REGISTRY_BASE_URL = "https://a2aregistry.org";
const FETCH_TIMEOUT_MS = 10_000;

export type A2ARegistrySkill = {
  tags?: string[];
};

/**
 * The subset of the A2A Registry's agent object
 * (https://a2aregistry.org/api/docs, GET /api/agents) this app actually
 * reads. The registry's own `is_healthy`/`uptime_percentage` are used only
 * to decide which candidates are worth importing — never stored as, or
 * merged into, AgentTrust's own reliability score.
 */
export type A2ARegistryAgent = {
  id: string;
  name: string;
  description?: string | null;
  url: string;
  version?: string | null;
  skills?: A2ARegistrySkill[];
  hidden?: boolean;
  flag_count?: number;
};

export class RegistryFetchError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "RegistryFetchError";
  }
}

/**
 * One bounded, unauthenticated read of the public A2A Registry — never more
 * than `limit` agents, never a second request, no crawling of individual
 * agent pages. `healthy=true` narrows to what the registry's own sweep
 * already found reachable, which is all this needs for a first import.
 *
 * Fails closed: a network error, a non-2xx response, or an unexpected body
 * shape all throw `RegistryFetchError` rather than returning a partial or
 * guessed result — a caller must treat that as "the import didn't run this
 * time", not as "zero agents are available."
 */
export async function fetchA2ARegistryAgents(
  limit: number,
): Promise<A2ARegistryAgent[]> {
  const url = `${A2A_REGISTRY_BASE_URL}/api/agents?healthy=true&limit=${limit}&offset=0`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
  } catch (error) {
    throw new RegistryFetchError(
      "Couldn't reach the public agent registry.",
      error,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new RegistryFetchError(
      `Public agent registry returned HTTP ${response.status}.`,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new RegistryFetchError(
      "Public agent registry returned a response that wasn't valid JSON.",
      error,
    );
  }

  const agentsField = (body as { agents?: unknown } | null)?.agents;
  if (!Array.isArray(agentsField)) {
    throw new RegistryFetchError(
      "Public agent registry response was in an unexpected shape.",
    );
  }

  return agentsField.filter(
    (candidate): candidate is A2ARegistryAgent =>
      typeof candidate === "object" &&
      candidate !== null &&
      typeof (candidate as { id?: unknown }).id === "string" &&
      typeof (candidate as { name?: unknown }).name === "string" &&
      typeof (candidate as { url?: unknown }).url === "string",
  );
}
