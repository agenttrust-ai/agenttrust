import "server-only";
import { agents } from "@/lib/db/schema";
import { withDbErrorNormalization, type AppDatabase } from "@/lib/db/rls";
import { AGENT_CARD_SCHEMA_VERSION } from "@/lib/validation/agent-card";
import { slugify } from "@/lib/validation/agent";
import { normalizeEndpointUrlForLookup, uniqueSlug, type Agent } from "./agents";

export type ExternallyObservedAgentInput = {
  name: string;
  description?: string;
  endpointUrl: string;
  version?: string;
  capabilityTags: string[];
  /** The source registry's own id for this agent — the idempotency key. */
  externalRegistryId: string;
};

/**
 * Every existing agent's endpoint (normalized the same way the public
 * `?endpoint_url=` lookup does — see `normalizeEndpointUrlForLookup`) and,
 * for previously-imported public agents, the external registry id that
 * produced them. Loaded once per import run so a batch of candidates can be
 * de-duplicated in memory instead of one query per candidate. Deliberately
 * scans every agent regardless of owner/visibility/lifecycle — a duplicate
 * must never be created against a draft or unlisted agent either, not just
 * against public+active ones.
 */
export async function getExistingAgentSignatures(db: AppDatabase): Promise<{
  normalizedEndpointUrls: Set<string>;
  externalRegistryIds: Set<string>;
}> {
  return withDbErrorNormalization(async () => {
    const rows = await db
      .select({
        endpointUrl: agents.endpointUrl,
        externalRegistryId: agents.externalRegistryId,
      })
      .from(agents);

    const normalizedEndpointUrls = new Set<string>();
    const externalRegistryIds = new Set<string>();
    for (const row of rows) {
      const normalized = normalizeEndpointUrlForLookup(row.endpointUrl);
      if (normalized) normalizedEndpointUrls.add(normalized);
      if (row.externalRegistryId) externalRegistryIds.add(row.externalRegistryId);
    }
    return { normalizedEndpointUrls, externalRegistryIds };
  });
}

/**
 * Inserts one externally-observed agent row. Never wrapped in
 * `withUserContext` — there is no owner to impersonate for RLS purposes —
 * so this runs as the same service-level connection the monitoring cron
 * itself already writes through (see `claimDueAgents`/`recordHealthCheck`
 * in `./health-checks.ts`, which are equally unwrapped).
 *
 * `ownerId: null` and `source: "externally_observed"` are set unconditionally
 * here, never derived from caller input — and even if a future caller got
 * that wrong, `agents_source_owner_consistency` (a DB CHECK constraint, not
 * application logic) would reject the insert outright. `lifecycleStatus:
 * "active"` is deliberate too: there is no owner who could ever click
 * "Activate", so an externally-observed agent starts on the monitoring
 * schedule immediately — draft would mean it can never be checked at all.
 */
export async function insertExternallyObservedAgent(
  db: AppDatabase,
  input: ExternallyObservedAgentInput,
): Promise<Agent> {
  return withDbErrorNormalization(async () => {
    const slug = await uniqueSlug(db, slugify(input.name));

    const [agent] = await db
      .insert(agents)
      .values({
        ownerId: null,
        slug,
        name: input.name,
        description: input.description ?? null,
        endpointUrl: input.endpointUrl,
        version: input.version ?? null,
        capabilityTags: input.capabilityTags,
        authType: "none",
        agentCard: { modalities: [], interactionType: null, documentationUrl: undefined },
        agentCardSchemaVersion: AGENT_CARD_SCHEMA_VERSION,
        visibility: "public",
        lifecycleStatus: "active",
        monitoringMode: "pull",
        source: "externally_observed",
        externalRegistryId: input.externalRegistryId,
        discoveredAt: new Date(),
      })
      .returning();
    return agent;
  });
}
