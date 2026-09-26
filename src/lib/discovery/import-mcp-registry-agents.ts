import "server-only";
import type { AppDatabase } from "@/lib/db/rls";
import { agentInputSchema } from "@/lib/validation/agent";
import {
  getExistingAgentSignatures,
  insertExternallyObservedAgent,
} from "@/lib/db/queries/public-agent-observation";
import { normalizeEndpointUrlForLookup, type Agent } from "@/lib/db/queries/agents";
import {
  countAgentsDiscoveredSince,
  getLatestDiscoveryResumeCursor,
  recordDiscoveryRun,
} from "@/lib/db/queries/discovery-progress";
import {
  fetchMcpRegistryServers,
  McpRegistryFetchError,
  type McpRegistryEntry,
  type McpRegistryPage,
} from "./mcp-registry";

/**
 * Hard ceiling on new agents per UTC day from this source — deliberately
 * far below the health-check cron's capacity (see
 * src/lib/monitoring/run-batch.ts), so discovery can never grow the
 * observation pool faster than monitoring can keep up with. Counted from
 * the database, so it also holds across a duplicate or repeated run.
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

/**
 * Most registry pages one run reads (x `fetchLimit` servers each). Bounds
 * registry load and run time, and guarantees progress: even a long stretch
 * of already-known or unusable servers is crossed a few pages per run
 * instead of blocking discovery on it.
 */
export const MCP_DISCOVERY_MAX_PAGES_PER_RUN = 5;

/** `audit_log.action` for a discovery run's record — also where the next run finds its resume cursor. */
export const MCP_DISCOVERY_RUN_ACTION = "mcp_registry_discovery.run";

export type McpDiscoveryStopReason =
  | "insert_cap_reached"
  | "daily_cap_already_reached"
  | "page_budget"
  | "end_of_registry"
  | "registry_error";

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
  pagesRead: number;
  stoppedReason: McpDiscoveryStopReason;
  /** Whether this run's resume point was recorded; if not, the next run re-reads from the previous one (safe — duplicates are skipped). */
  progressSaved: boolean;
};

export type McpImportOptions = {
  /** How many server records to read per registry page. */
  fetchLimit: number;
  /** How many candidates may be inserted today — clamped to MCP_DISCOVERY_DAILY_INSERT_CAP regardless of what's passed. */
  insertLimit?: number;
  /** Most pages this run reads; defaults to MCP_DISCOVERY_MAX_PAGES_PER_RUN. */
  maxPages?: number;
  /** Injectable clock — tests only. */
  now?: () => Date;
};

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/**
 * A 4xx on a request that carried a stored cursor means the registry
 * rejected that cursor itself (5xx and network errors are the registry
 * being unavailable, which a later run should simply retry).
 */
function isRejectedCursor(error: unknown, cursor: string | null): boolean {
  return (
    cursor !== null &&
    error instanceof McpRegistryFetchError &&
    typeof error.status === "number" &&
    error.status >= 400 &&
    error.status < 500
  );
}

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
 *   official MCP Registry (resuming from the last recorded page) -> extract
 *   explicit remote URLs only -> filter (registry moderation status + the
 *   exact same SSRF/HTTPS validation owner registration goes through) ->
 *   de-duplicate against every existing agent -> insert up to today's
 *   remaining MCP_DISCOVERY_DAILY_INSERT_CAP -> record where to resume ->
 *   return a full accounting.
 *
 * Paging: reads up to `maxPages` pages per run, starting from the cursor the
 * previous run recorded (in `audit_log`, so it survives restarts and
 * redeploys). A page is only moved past once every candidate on it has been
 * considered — if the cap is reached part-way through one, the next run
 * re-reads that page (already-inserted agents are then skipped as
 * duplicates). Pages with nothing new never block progress: they're simply
 * crossed. At the end of the registry the next run starts over from the
 * first page, which is the only time discovery goes back to the start.
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
 * the rest of the batch. A registry-fetch failure still fails the run
 * (propagates `McpRegistryFetchError`), but only after recording progress
 * up to the last page fully processed, so nothing already done is repeated
 * and the failed page is retried next time.
 */
export async function importMcpRegistryAgents(
  db: AppDatabase,
  options: McpImportOptions,
): Promise<McpImportSummary> {
  const clock = options.now ?? (() => new Date());
  const maxPages = options.maxPages ?? MCP_DISCOVERY_MAX_PAGES_PER_RUN;
  const dailyLimit = Math.min(
    options.insertLimit ?? MCP_DISCOVERY_DAILY_INSERT_CAP,
    MCP_DISCOVERY_DAILY_INSERT_CAP,
  );

  const startCursor = await getLatestDiscoveryResumeCursor(
    db,
    MCP_DISCOVERY_RUN_ACTION,
  );
  const insertedToday = await countAgentsDiscoveredSince(
    db,
    REGISTRY_SOURCE_PREFIX,
    startOfUtcDay(clock()),
  );
  const insertLimit = Math.max(0, dailyLimit - insertedToday);

  const inserted: Agent[] = [];
  const rejected: SkippedMcpCandidate[] = [];
  const duplicatesSkipped: SkippedMcpCandidate[] = [];
  const cappedBeforeInsert: SkippedMcpCandidate[] = [];
  const errors: SkippedMcpCandidate[] = [];

  let sourceCandidates = 0;
  let validCandidates = 0;
  let pagesRead = 0;
  let cursor: string | null = startCursor;
  let resumeCursor: string | null = startCursor;
  let cursorReset = false;
  let stoppedReason: McpDiscoveryStopReason = "page_budget";
  let registryError: unknown = null;

  if (insertLimit === 0) {
    stoppedReason = "daily_cap_already_reached";
  } else {
    const { normalizedEndpointUrls, externalRegistryIds } =
      await getExistingAgentSignatures(db);

    const processEntries = async (entries: McpRegistryEntry[]): Promise<void> => {
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
    };

    for (;;) {
      if (pagesRead >= maxPages) {
        stoppedReason = "page_budget";
        resumeCursor = cursor;
        break;
      }

      let page: McpRegistryPage;
      try {
        page = await fetchMcpRegistryServers(options.fetchLimit, cursor ?? undefined);
      } catch (error) {
        // The registry rejected the stored cursor itself: start over from
        // the first page once, rather than being stuck on it forever.
        if (!cursorReset && isRejectedCursor(error, cursor)) {
          cursorReset = true;
          cursor = null;
          continue;
        }
        registryError = error;
        stoppedReason = "registry_error";
        resumeCursor = cursor;
        break;
      }
      pagesRead += 1;

      const cappedBeforePage = cappedBeforeInsert.length;
      await processEntries(page.entries);

      if (cappedBeforeInsert.length > cappedBeforePage) {
        // The cap was reached part-way through this page — re-read it next
        // run so its remaining candidates aren't skipped.
        stoppedReason = "insert_cap_reached";
        resumeCursor = cursor;
        break;
      }
      if (page.nextCursor === null) {
        // End of the registry: the next run deliberately starts over.
        stoppedReason = "end_of_registry";
        resumeCursor = null;
        break;
      }
      cursor = page.nextCursor;
      if (inserted.length >= insertLimit) {
        stoppedReason = "insert_cap_reached";
        resumeCursor = cursor;
        break;
      }
    }
  }

  let progressSaved = false;
  try {
    await recordDiscoveryRun(db, MCP_DISCOVERY_RUN_ACTION, {
      resumeCursor,
      startCursor,
      cursorReset,
      pagesRead,
      stoppedReason,
      insertedTodayBeforeRun: insertedToday,
      sourceCandidates,
      validCandidates,
      inserted: inserted.length,
      rejected: rejected.length,
      duplicatesSkipped: duplicatesSkipped.length,
      cappedBeforeInsert: cappedBeforeInsert.length,
      errors: errors.length,
    });
    progressSaved = true;
  } catch (error) {
    // Not fatal: without a new record the next run resumes from the
    // previous one and re-reads pages already seen — duplicates are skipped.
    console.error("Couldn't record MCP discovery progress:", error);
  }

  if (registryError) throw registryError;

  return {
    sourceCandidates,
    validCandidates,
    inserted,
    rejected,
    duplicatesSkipped,
    cappedBeforeInsert,
    errors,
    pagesRead,
    stoppedReason,
    progressSaved,
  };
}
