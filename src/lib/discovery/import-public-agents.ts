import "server-only";
import type { AppDatabase } from "@/lib/db/rls";
import { agentInputSchema } from "@/lib/validation/agent";
import {
  getExistingAgentSignatures,
  insertExternallyObservedAgent,
} from "@/lib/db/queries/public-agent-observation";
import { normalizeEndpointUrlForLookup, type Agent } from "@/lib/db/queries/agents";
import {
  fetchA2ARegistryAgents,
  type A2ARegistryAgent,
} from "./a2a-registry";

const CAPABILITY_TAG_RE = /^[a-z0-9][a-z0-9-]*$/;
const MAX_CAPABILITY_TAGS = 20;

/**
 * The registry's skill tags are free text from a community-run source —
 * unlike the dashboard's own comma-separated field, nothing upstream
 * already constrains them to `agentInputSchema`'s capability-tag shape.
 * Normalizing here means a candidate is never rejected outright just
 * because one of its tags had a space or a capital letter in it.
 */
function normalizeCapabilityTags(agent: A2ARegistryAgent): string[] {
  const raw = (agent.skills ?? []).flatMap((skill) => skill.tags ?? []);
  const normalized = raw
    .map((tag) =>
      tag
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40),
    )
    .filter((tag) => tag.length > 0 && CAPABILITY_TAG_RE.test(tag));
  return Array.from(new Set(normalized)).slice(0, MAX_CAPABILITY_TAGS);
}

export type SkippedCandidate = {
  registryId: string | null;
  name: string | null;
  reason:
    | "hidden"
    | "flagged"
    | "missing_required_fields"
    | "validation_failed"
    | "duplicate_endpoint"
    | "duplicate_registry_id"
    | "insert_cap_reached";
  detail?: string;
};

export type ImportSummary = {
  discovered: number;
  inserted: Agent[];
  filtered: SkippedCandidate[];
  duplicatesSkipped: SkippedCandidate[];
  cappedBeforeInsert: SkippedCandidate[];
};

export type ImportOptions = {
  /** How many candidates to read from the registry in one bounded request. */
  fetchLimit: number;
  /** How many of those candidates may actually be inserted this run. */
  insertLimit: number;
};

/**
 * The whole discovery pipeline, end to end:
 *
 *   public registry -> filter (moderation + validation, incl. the exact
 *   same SSRF/HTTPS check owner registration goes through) -> de-duplicate
 *   against every existing agent -> insert up to `insertLimit` -> return a
 *   full accounting.
 *
 * Deliberately does NOT call the monitoring cron, compute a score, or touch
 * anything beyond the `agents` table — those already run on their own
 * schedule (or a manually-triggered one, for this first run) against
 * whatever rows exist with `lifecycle_status = 'active'`, regardless of how
 * they got there.
 */
export async function importPublicAgents(
  db: AppDatabase,
  options: ImportOptions,
): Promise<ImportSummary> {
  const candidates = await fetchA2ARegistryAgents(options.fetchLimit);
  const { normalizedEndpointUrls, externalRegistryIds } =
    await getExistingAgentSignatures(db);

  const inserted: Agent[] = [];
  const filtered: SkippedCandidate[] = [];
  const duplicatesSkipped: SkippedCandidate[] = [];
  const cappedBeforeInsert: SkippedCandidate[] = [];

  for (const candidate of candidates) {
    const identity = { registryId: candidate.id ?? null, name: candidate.name ?? null };

    if (candidate.hidden) {
      filtered.push({ ...identity, reason: "hidden" });
      continue;
    }
    if ((candidate.flag_count ?? 0) > 0) {
      filtered.push({ ...identity, reason: "flagged" });
      continue;
    }
    if (!candidate.id || !candidate.name || !candidate.url) {
      filtered.push({ ...identity, reason: "missing_required_fields" });
      continue;
    }

    // The exact same schema real (owner) registration validates against —
    // including the SSRF/HTTPS check embedded in its endpointUrl field. A
    // candidate that wouldn't be allowed through the dashboard form isn't
    // allowed in here either.
    const parsed = agentInputSchema.safeParse({
      name: candidate.name,
      description: candidate.description ?? undefined,
      endpointUrl: candidate.url,
      version: candidate.version ?? undefined,
      capabilities: normalizeCapabilityTags(candidate),
      authType: "none",
    });
    if (!parsed.success) {
      filtered.push({
        ...identity,
        reason: "validation_failed",
        detail: parsed.error.issues[0]?.message,
      });
      continue;
    }

    if (externalRegistryIds.has(candidate.id)) {
      duplicatesSkipped.push({ ...identity, reason: "duplicate_registry_id" });
      continue;
    }
    const normalizedUrl = normalizeEndpointUrlForLookup(parsed.data.endpointUrl);
    if (normalizedUrl && normalizedEndpointUrls.has(normalizedUrl)) {
      duplicatesSkipped.push({ ...identity, reason: "duplicate_endpoint" });
      continue;
    }

    if (inserted.length >= options.insertLimit) {
      cappedBeforeInsert.push({ ...identity, reason: "insert_cap_reached" });
      continue;
    }

    const agent = await insertExternallyObservedAgent(db, {
      name: parsed.data.name,
      description: parsed.data.description,
      endpointUrl: parsed.data.endpointUrl,
      version: parsed.data.version,
      capabilityTags: parsed.data.capabilities,
      externalRegistryId: candidate.id,
    });
    inserted.push(agent);

    // Update in-memory signatures immediately so two candidates in the same
    // batch that happen to share a URL (or, in principle, a registry id)
    // can't both be inserted.
    externalRegistryIds.add(candidate.id);
    if (normalizedUrl) normalizedEndpointUrls.add(normalizedUrl);
  }

  return {
    discovered: candidates.length,
    inserted,
    filtered,
    duplicatesSkipped,
    cappedBeforeInsert,
  };
}
