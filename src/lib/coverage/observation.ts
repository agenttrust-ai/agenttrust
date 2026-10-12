import "server-only";
import { asc, count, eq, gte, lt, or, sql } from "drizzle-orm";
import { agents, observationRequests } from "@/lib/db/schema";
import { withDbErrorNormalization, type AppDatabase } from "@/lib/db/rls";
import { normalizeEndpointUrlForLookup } from "@/lib/db/queries/agents";
import { insertExternallyObservedAgent } from "@/lib/db/queries/public-agent-observation";
import { countAgentsDiscoveredSince } from "@/lib/db/queries/discovery-progress";
import { checkSafeAgentUrl } from "@/lib/security/url-safety";
import {
  endpointKey,
  sanitizeEndpointHost,
  telemetryHashKey,
} from "@/lib/telemetry/trust-check-events";
import {
  fetchMcpRegistryServers,
  type McpRegistryEntry,
} from "@/lib/discovery/mcp-registry";
import {
  candidateUrlsFor,
  MCP_DISCOVERY_DAILY_INSERT_CAP,
  REGISTRY_SOURCE_PREFIX,
} from "@/lib/discovery/import-mcp-registry-agents";
import { agentInputSchema } from "@/lib/validation/agent";

/**
 * Demand-driven coverage, phase 1: when `check_agent_trust` is asked about an
 * endpoint AgentTrust doesn't know, record that demand and — later, in the
 * daily discovery run — look the URL up in the official MCP Registry. A
 * registry server that publishes this exact URL becomes an observed agent,
 * exactly as if discovery had reached it on its own.
 *
 * What it never does:
 *   - Contact the endpoint. Recording demand is a database write; the
 *     registry lookup reads only registry.modelcontextprotocol.io. The
 *     endpoint is probed only later, by ordinary monitoring, and only once
 *     it is a registry server's published URL.
 *   - Store the URL a caller sent. A request is identified only by the same
 *     pair an unmatched telemetry event keeps — a sanitized public hostname
 *     and a keyed hash of the URL without query/fragment — and matched by
 *     hashing the URLs registry servers publish.
 *   - Observe anything that isn't in the MCP Registry (phase 1).
 *   - Invent a score or verification: an observed agent starts with no
 *     history and reads as insufficient data until monitoring builds one.
 */

export type ObservationStatus = "pending" | "observing" | "not_in_registry";

export const OBSERVATION_STATUSES = ["pending", "observing", "not_in_registry"] as const;

/** At most this many requests wait for a registry lookup at once. */
export const OBSERVATION_MAX_PENDING = 500;
/** At most this many new endpoints are recorded per UTC day. */
export const OBSERVATION_DAILY_NEW_REQUESTS = 200;
/** A `not_in_registry` endpoint asked about again after this long is looked up again. */
export const OBSERVATION_RECHECK_AFTER_DAYS = 30;
/** Requests nobody has asked about for this long are deleted. */
export const OBSERVATION_RETENTION_DAYS = 90;
/** Pending requests considered per discovery run. */
export const OBSERVATION_BATCH_PER_RUN = 20;
/** Registry searches per discovery run. */
export const OBSERVATION_MAX_LOOKUPS_PER_RUN = 10;
/** Failed registry lookups before a request is resolved as not found. */
export const OBSERVATION_MAX_LOOKUP_ATTEMPTS = 3;
const REGISTRY_SEARCH_PAGE_SIZE = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

export const OBSERVATION_MESSAGES: Record<ObservationStatus, string> = {
  pending:
    "AgentTrust has no data for this endpoint yet. It is queued for a lookup in the official MCP Registry: if a server published there uses this exact URL, AgentTrust will start monitoring it, and a trust result will build up over the following days. No score or verification exists yet.",
  observing:
    "AgentTrust already tracks or has started observing this endpoint, but has no public monitoring history for it yet. No score or verification exists yet.",
  not_in_registry:
    "No server in the official MCP Registry publishes this URL, so AgentTrust doesn't observe it automatically. Its owner can register it at https://getagenttrust.com/dashboard/agents/new.",
};

/**
 * Off unless explicitly enabled, and never without the telemetry key: the
 * key is what makes the endpoint hash (the only identifier stored) possible.
 */
export function isDemandCoverageEnabled(): boolean {
  return process.env.DEMAND_COVERAGE_ENABLED === "true" && telemetryHashKey() !== null;
}

/** RFC 2606 example names never belong to a real server. */
function isReservedExampleHost(host: string): boolean {
  return ["example.com", "example.net", "example.org", "example"].some(
    (name) => host === name || host.endsWith(`.${name}`),
  );
}

export type ObservationCandidate = { endpointKey: string; endpointHost: string };

/**
 * The privacy-safe identity of an endpoint that may be queued, or null when
 * it never may: not an absolute https URL, credentials in it, a localhost,
 * private, link-local or otherwise reserved address (the same static SSRF
 * checks owner registration applies), not a public DNS hostname, a reserved
 * example domain, or no telemetry key to hash with. No DNS lookup or network
 * request happens here.
 */
export function observationCandidate(
  endpointUrl: string,
  key: string | null,
): ObservationCandidate | null {
  if (!key) return null;
  if (!checkSafeAgentUrl(endpointUrl).safe) return null;
  const host = sanitizeEndpointHost(endpointUrl);
  if (!host || isReservedExampleHost(host)) return null;
  const hashed = endpointKey(endpointUrl, key);
  return hashed ? { endpointKey: hashed, endpointHost: host } : null;
}

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export type RecordDemandOptions = {
  now?: Date;
  maxPending?: number;
  dailyNewRequests?: number;
};

/**
 * Records one request for an unknown endpoint and returns its observation
 * status, or null when it wasn't recorded (a cap was reached). The same
 * endpoint — whatever its query string, trailing slash or host casing — is
 * one row. Caps are soft under concurrency, which is fine for their
 * purpose: bounding the table and the registry lookups it leads to.
 */
export async function recordObservationDemand(
  db: AppDatabase,
  candidate: ObservationCandidate,
  options: RecordDemandOptions = {},
): Promise<ObservationStatus | null> {
  const now = options.now ?? new Date();
  const maxPending = options.maxPending ?? OBSERVATION_MAX_PENDING;
  const dailyNew = options.dailyNewRequests ?? OBSERVATION_DAILY_NEW_REQUESTS;

  return withDbErrorNormalization(async () => {
    const pendingCount = async () => {
      const [{ n }] = await db
        .select({ n: count() })
        .from(observationRequests)
        .where(eq(observationRequests.status, "pending"));
      return Number(n);
    };

    const [existing] = await db
      .select()
      .from(observationRequests)
      .where(eq(observationRequests.endpointKey, candidate.endpointKey))
      .limit(1);

    if (existing) {
      const recheckDue =
        existing.status === "not_in_registry" &&
        existing.resolvedAt !== null &&
        now.getTime() - existing.resolvedAt.getTime() >= OBSERVATION_RECHECK_AFTER_DAYS * DAY_MS;
      const requeue = recheckDue && (await pendingCount()) < maxPending;
      const [row] = await db
        .update(observationRequests)
        .set({
          requestCount: sql`${observationRequests.requestCount} + 1`,
          lastRequestedAt: now,
          ...(requeue ? { status: "pending", lookupAttempts: 0, resolvedAt: null } : {}),
        })
        .where(eq(observationRequests.id, existing.id))
        .returning({ status: observationRequests.status });
      return row.status as ObservationStatus;
    }

    if ((await pendingCount()) >= maxPending) return null;
    const [{ today }] = await db
      .select({ today: count() })
      .from(observationRequests)
      .where(gte(observationRequests.firstRequestedAt, startOfUtcDay(now)));
    if (Number(today) >= dailyNew) return null;

    const [row] = await db
      .insert(observationRequests)
      .values({
        endpointKey: candidate.endpointKey,
        endpointHost: candidate.endpointHost,
        firstRequestedAt: now,
        lastRequestedAt: now,
      })
      .onConflictDoUpdate({
        target: observationRequests.endpointKey,
        set: {
          requestCount: sql`${observationRequests.requestCount} + 1`,
          lastRequestedAt: now,
        },
      })
      .returning({ status: observationRequests.status });
    return row.status as ObservationStatus;
  });
}

/**
 * For `check_agent_trust`'s unmatched branch: the observation status to
 * report, or null when demand coverage is off, the URL isn't eligible, a cap
 * was reached, or recording failed. Never throws — the trust check's own
 * answer must not depend on this.
 */
export async function observeUnknownEndpoint(
  db: AppDatabase,
  endpointUrl: string,
): Promise<{ status: ObservationStatus; message: string } | null> {
  if (!isDemandCoverageEnabled()) return null;
  try {
    const candidate = observationCandidate(endpointUrl, telemetryHashKey());
    if (!candidate) return null;
    const status = await recordObservationDemand(db, candidate);
    return status ? { status, message: OBSERVATION_MESSAGES[status] } : null;
  } catch (error) {
    console.error(
      "Observation demand was not recorded:",
      error instanceof Error ? error.name : "unknown error",
    );
    return null;
  }
}

/**
 * Second-level labels under which a country-code TLD registers names
 * (example.co.uk), so the registrable domain is three labels, not two.
 */
const SECOND_LEVEL_LABELS = new Set(["ac", "co", "com", "edu", "go", "gov", "ne", "net", "or", "org"]);

/**
 * The MCP Registry search term for a host: its registrable domain in
 * reverse-DNS order, the namespace a domain-verified server name starts with
 * (mcp.example.co.uk -> "uk.co.example"). Only public hostnames reach here,
 * so every label is [a-z0-9-].
 */
export function registrySearchTerm(host: string): string | null {
  const labels = host.toLowerCase().split(".");
  if (labels.length < 2) return null;
  const take =
    labels.length >= 3 &&
    labels[labels.length - 1].length === 2 &&
    SECOND_LEVEL_LABELS.has(labels[labels.length - 2])
      ? 3
      : 2;
  return labels.slice(-take).reverse().join(".");
}

export type ObservationProcessSummary = {
  enabled: boolean;
  considered: number;
  lookups: number;
  lookupErrors: number;
  observing: number;
  linkedExisting: number;
  notInRegistry: number;
  deferredByCap: number;
  expiredDeleted: number;
};

export type ProcessObservationOptions = {
  now?: Date;
  key?: string | null;
  fetchRegistry?: typeof fetchMcpRegistryServers;
  /** Upper bound on new agents this run; never above the shared daily discovery cap. */
  insertLimit?: number;
  batchSize?: number;
  maxLookups?: number;
};

/**
 * One bounded pass over pending requests, run from the daily discovery cron
 * before the regular registry import: deletes requests nobody has asked
 * about in OBSERVATION_RETENTION_DAYS, takes the oldest pending ones, looks
 * each host's namespace up in the MCP Registry (one search per host, at most
 * `maxLookups`), and matches every active server's published streamable-http
 * URLs against the stored hashes. A match becomes an observed agent through
 * the same validation (including the SSRF/HTTPS check) and insert discovery
 * uses, counted against the same daily cap — so demand only reorders what
 * discovery would add, never raises how much it adds per day.
 */
export async function processObservationQueue(
  db: AppDatabase,
  options: ProcessObservationOptions = {},
): Promise<ObservationProcessSummary> {
  const now = options.now ?? new Date();
  const key = options.key === undefined ? telemetryHashKey() : options.key;
  const fetchRegistry = options.fetchRegistry ?? fetchMcpRegistryServers;
  const summary: ObservationProcessSummary = {
    enabled: key !== null,
    considered: 0,
    lookups: 0,
    lookupErrors: 0,
    observing: 0,
    linkedExisting: 0,
    notInRegistry: 0,
    deferredByCap: 0,
    expiredDeleted: 0,
  };
  if (!key) return summary;

  const expired = await withDbErrorNormalization(() =>
    db
      .delete(observationRequests)
      .where(lt(observationRequests.lastRequestedAt, new Date(now.getTime() - OBSERVATION_RETENTION_DAYS * DAY_MS)))
      .returning({ id: observationRequests.id }),
  );
  summary.expiredDeleted = expired.length;

  const pending = await withDbErrorNormalization(() =>
    db
      .select()
      .from(observationRequests)
      .where(eq(observationRequests.status, "pending"))
      .orderBy(asc(observationRequests.firstRequestedAt))
      .limit(options.batchSize ?? OBSERVATION_BATCH_PER_RUN),
  );
  summary.considered = pending.length;
  if (pending.length === 0) return summary;

  const cap = Math.min(options.insertLimit ?? MCP_DISCOVERY_DAILY_INSERT_CAP, MCP_DISCOVERY_DAILY_INSERT_CAP);
  const insertedToday = await countAgentsDiscoveredSince(db, REGISTRY_SOURCE_PREFIX, startOfUtcDay(now));
  let insertBudget = Math.max(0, cap - insertedToday);

  const resolve = (id: string, set: Partial<typeof observationRequests.$inferInsert>) =>
    withDbErrorNormalization(() =>
      db.update(observationRequests).set(set).where(eq(observationRequests.id, id)),
    );

  const byTerm = new Map<string, typeof pending>();
  for (const row of pending) {
    const term = registrySearchTerm(row.endpointHost);
    if (!term) {
      await resolve(row.id, { status: "not_in_registry", resolvedAt: now });
      summary.notInRegistry += 1;
      continue;
    }
    byTerm.set(term, [...(byTerm.get(term) ?? []), row]);
  }

  const maxLookups = options.maxLookups ?? OBSERVATION_MAX_LOOKUPS_PER_RUN;
  for (const [term, rows] of byTerm) {
    if (summary.lookups >= maxLookups) break;
    summary.lookups += 1;

    let entries: McpRegistryEntry[];
    try {
      entries = (await fetchRegistry(REGISTRY_SEARCH_PAGE_SIZE, undefined, term)).entries;
    } catch {
      summary.lookupErrors += 1;
      for (const row of rows) {
        const attempts = row.lookupAttempts + 1;
        await resolve(
          row.id,
          attempts >= OBSERVATION_MAX_LOOKUP_ATTEMPTS
            ? { lookupAttempts: attempts, status: "not_in_registry", resolvedAt: now }
            : { lookupAttempts: attempts },
        );
      }
      continue;
    }

    // Every active server's published URL, by the same keyed hash the
    // requests are stored under.
    const published = new Map<string, { url: string; registryId: string; entry: McpRegistryEntry }>();
    for (const entry of entries) {
      if (entry.status !== "active") continue;
      for (const candidate of candidateUrlsFor(entry)) {
        const hashed = endpointKey(candidate.url, key);
        if (hashed && !published.has(hashed)) published.set(hashed, { ...candidate, entry });
      }
    }

    for (const row of rows) {
      const match = published.get(row.endpointKey);
      if (!match) {
        await resolve(row.id, {
          status: "not_in_registry",
          resolvedAt: now,
          lookupAttempts: row.lookupAttempts + 1,
        });
        summary.notInRegistry += 1;
        continue;
      }

      const normalized = normalizeEndpointUrlForLookup(match.url);
      const [existingAgent] = await withDbErrorNormalization(() =>
        db
          .select({ id: agents.id })
          .from(agents)
          .where(
            normalized
              ? or(eq(agents.externalRegistryId, match.registryId), eq(agents.endpointUrlNormalized, normalized))
              : eq(agents.externalRegistryId, match.registryId),
          )
          .limit(1),
      );
      if (existingAgent) {
        await resolve(row.id, { status: "observing", agentId: existingAgent.id, resolvedAt: now });
        summary.linkedExisting += 1;
        continue;
      }

      if (insertBudget <= 0) {
        summary.deferredByCap += 1;
        continue;
      }

      const server = match.entry.server;
      const parsed = agentInputSchema.safeParse({
        name: server.title || server.name,
        description: server.description ?? undefined,
        endpointUrl: match.url,
        version: server.version,
        capabilities: [],
        authType: "none",
      });
      if (!parsed.success) {
        await resolve(row.id, { status: "not_in_registry", resolvedAt: now });
        summary.notInRegistry += 1;
        continue;
      }

      const agent = await insertExternallyObservedAgent(db, {
        name: parsed.data.name,
        description: parsed.data.description,
        endpointUrl: parsed.data.endpointUrl,
        version: parsed.data.version,
        capabilityTags: parsed.data.capabilities,
        externalRegistryId: match.registryId,
      });
      insertBudget -= 1;
      await resolve(row.id, { status: "observing", agentId: agent.id, resolvedAt: now });
      summary.observing += 1;
    }
  }

  return summary;
}

/** Request counts by status — for the cron summary and tests. */
export async function countObservationRequestsByStatus(db: AppDatabase): Promise<Record<string, number>> {
  const rows = await db
    .select({ status: observationRequests.status, n: count() })
    .from(observationRequests)
    .groupBy(observationRequests.status);
  return Object.fromEntries(rows.map((row) => [row.status, Number(row.n)]));
}

