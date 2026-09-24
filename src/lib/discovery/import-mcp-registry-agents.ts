import "server-only";
import type { AppDatabase } from "@/lib/db/rls";
import { agentInputSchema } from "@/lib/validation/agent";
import {
  getExistingAgentSignatures,
  insertExternallyObservedAgent,
} from "@/lib/db/queries/public-agent-observation";
import { normalizeEndpointUrlForLookup, type Agent } from "@/lib/db/queries/agents";
import { fetchMcpRegistryServers, type McpRegistryEntry } from "./mcp-registry";

/**
 * Stage 1's hard ceiling on new agents per discovery run — deliberately
 * well below the health-check cron's own batch size (20, see
 * src/app/api/internal/cron/run-health-checks/route.ts), so discovery can
 * never grow the observation pool faster than monitoring can keep up with.
 */
export const MCP_DISCOVERY_DAILY_INSERT_CAP = 10;

/**
 * Every externally-observed agent this source produces gets an
 * `externalRegistryId` namespaced with this prefix — `insertLimit`'s
 * uniqueness only has to hold *within* one source today, but prefixing
 * costs nothing and rules out a future collision with the A2A Registry
 * pipeline's own (unprefixed, opaque) ids in `src/lib/discovery/a2a-registry.ts`.
 */
const REGISTRY_SOURCE_PREFIX = "mcp-registry:";

export type SkippedMcpCandidate = {
  externalRegistryId: string | null;
  name: string | null;
  reason:
    | "not_active"
    | "no_remote_endpoint"
    | "validation_failed"
    | "duplicate_endpoint"
    | "duplicate_registry_id"
    | "insert_cap_reached"
    | "insert_failed";
  detail?: string;
};

export type McpImportSummary = {
  /** Every (server, remote URL) pair considered, before any filtering. */
  sourceCandidates: number;
  /** Candidates that passed moderation + schema/SSRF validation. */
  validCandidates: number;
  inserted: Agent[];
  rejected: SkippedMcpCandidate[];
  duplicatesSkipped: SkippedMcpCandidate[];
  cappedBeforeInsert: SkippedMcpCandidate[];
  /** One candidate's unexpected failure — never the whole run's. */
  errors: SkippedMcpCandidate[];
};

export type McpImportOptions = {
  /** How many server records to read from the registry in one bounded request. */
  fetchLimit: number;
  /** How many candidates this run may actually insert — clamped to MCP_DISCOVERY_DAILY_INSERT_CAP regardless of what's passed. */
  insertLimit?: number;
};

/**
 * One MCP Registry server can publish multiple remotes (e.g. two mirrored
 * `streamable-http` URLs) — each is a distinct candidate endpoint, not a
 * duplicate of the other. Only `streamable-http` is considered: `stdio` has
 * no URL at all (a local subprocess launcher, never a remote endpoint) and
 * `sse` isn't a transport this project probes or invokes anywhere else.
 * Never derives a URL from the server's name, repository, or description —
 * only ever the registry's own explicit `remotes[].url`.
 */
function candidateUrlsFor(
  entry: McpRegistryEntry,
): { url: string; registryId: string }[] {
  const remotes = entry.server.remotes ?? [];
  const out: { url: string; registryId: string }[] = [];
  for (const remote of remotes) {
    if (remote.type !== "streamable-http") continue;
    if (!remote.url || typeof remote.url !== "string") continue;
    out.push({
      url: remote.url,
      registryId: `${REGISTRY_SOURCE_PREFIX}${entry.server.name}:${remote.url}`,
    });
  }
  return out;
}

/**
 * The whole MCP Registry discovery pipeline, end to end:
 *
 *   official MCP Registry -> extract explicit remote URLs only -> filter
 *   (registry moderation status + the exact same SSRF/HTTPS validation
 *   owner registration goes through) -> de-duplicate against every
 *   existing agent -> insert up to MCP_DISCOVERY_DAILY_INSERT_CAP -> return
 *   a full accounting.
 *
 * Never contacts a discovered endpoint itself — only the registry's own
 * API, read-only. Every inserted agent is unclaimed (`ownerId: null`),
 * unverified (`ownershipVerifiedAt` stays null), and starts with no
 * reliability score or monitoring history — `computeTrustDecision`
 * (src/lib/reliability/trust-decision.ts) is untouched by this module, so a
 * freshly discovered agent reads exactly as `insufficient_data` /
 * not-recommended until real monitoring history exists, same as any other
 * newly registered agent.
 *
 * A single candidate's unexpected failure (e.g. a transient DB error on
 * just that insert) is caught and recorded in `errors` — it never aborts
 * the rest of the batch. A total registry-fetch failure is different: it
 * fails the whole run closed (propagates `McpRegistryFetchError`), the same
 * way the A2A Registry pipeline already does — if the only source for this
 * run is unreachable, there is nothing to import, and pretending otherwise
 * would be wrong.
 */
export async function importMcpRegistryAgents(
  db: AppDatabase,
  options: McpImportOptions,
): Promise<McpImportSummary> {
  const insertLimit = Math.min(
    options.insertLimit ?? MCP_DISCOVERY_DAILY_INSERT_CAP,
    MCP_DISCOVERY_DAILY_INSERT_CAP,
  );

  const entries = await fetchMcpRegistryServers(options.fetchLimit);
  const { normalizedEndpointUrls, externalRegistryIds } =
    await getExistingAgentSignatures(db);

  const inserted: Agent[] = [];
  const rejected: SkippedMcpCandidate[] = [];
  const duplicatesSkipped: SkippedMcpCandidate[] = [];
  const cappedBeforeInsert: SkippedMcpCandidate[] = [];
  const errors: SkippedMcpCandidate[] = [];

  let sourceCandidates = 0;
  let validCandidates = 0;

  for (const entry of entries) {
    const displayName = entry.server.title || entry.server.name;
    const candidates = candidateUrlsFor(entry);

    if (candidates.length === 0) {
      sourceCandidates += 1;
      rejected.push({
        externalRegistryId: null,
        name: displayName,
        reason: "no_remote_endpoint",
      });
      continue;
    }

    for (const { url, registryId } of candidates) {
      sourceCandidates += 1;
      const identity = { externalRegistryId: registryId, name: displayName };

      try {
        if (entry.status !== "active") {
          rejected.push({ ...identity, reason: "not_active", detail: entry.status });
          continue;
        }

        // The exact same schema real (owner) registration validates
        // against — including the SSRF/HTTPS check embedded in
        // endpointUrl. A candidate that wouldn't be allowed through the
        // dashboard form isn't allowed in here either.
        const parsed = agentInputSchema.safeParse({
          name: displayName,
          description: entry.server.description ?? undefined,
          endpointUrl: url,
          version: entry.server.version,
          capabilities: [],
          authType: "none",
        });
        if (!parsed.success) {
          rejected.push({
            ...identity,
            reason: "validation_failed",
            detail: parsed.error.issues[0]?.message,
          });
          continue;
        }
        validCandidates += 1;

        if (externalRegistryIds.has(registryId)) {
          duplicatesSkipped.push({ ...identity, reason: "duplicate_registry_id" });
          continue;
        }
        const normalizedUrl = normalizeEndpointUrlForLookup(parsed.data.endpointUrl);
        if (normalizedUrl && normalizedEndpointUrls.has(normalizedUrl)) {
          duplicatesSkipped.push({ ...identity, reason: "duplicate_endpoint" });
          continue;
        }

        if (inserted.length >= insertLimit) {
          cappedBeforeInsert.push({ ...identity, reason: "insert_cap_reached" });
          continue;
        }

        const agent = await insertExternallyObservedAgent(db, {
          name: parsed.data.name,
          description: parsed.data.description,
          endpointUrl: parsed.data.endpointUrl,
          version: parsed.data.version,
          capabilityTags: parsed.data.capabilities,
          externalRegistryId: registryId,
        });
        inserted.push(agent);

        // Update in-memory signatures immediately so two candidates in the
        // same batch that happen to share a URL can't both be inserted.
        externalRegistryIds.add(registryId);
        if (normalizedUrl) normalizedEndpointUrls.add(normalizedUrl);
      } catch (error) {
        errors.push({
          ...identity,
          reason: "insert_failed",
          detail: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  }

  return {
    sourceCandidates,
    validCandidates,
    inserted,
    rejected,
    duplicatesSkipped,
    cappedBeforeInsert,
    errors,
  };
}
