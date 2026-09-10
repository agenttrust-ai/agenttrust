import { z } from "zod";

/**
 * Bumped whenever the *shape* of the Agent Card document changes — stored
 * on every agent alongside the card itself so a future consumer can tell
 * which rules produced it. Always server-set (see `agentColumns` in
 * src/lib/db/queries/agents.ts); a write never trusts a client-supplied
 * version.
 */
export const AGENT_CARD_SCHEMA_VERSION = "1.0";

export const AGENT_CARD_MODALITIES = [
  "text",
  "json",
  "audio",
  "image",
  "video",
  "file",
] as const;
export type AgentCardModality = (typeof AGENT_CARD_MODALITIES)[number];

export const AGENT_CARD_INTERACTION_TYPES = [
  "request-response",
  "streaming",
  "async",
] as const;
export type AgentCardInteractionType = (typeof AGENT_CARD_INTERACTION_TYPES)[number];

const MAX_DOCUMENTATION_URL_LENGTH = 500;
/**
 * Defense in depth beyond the field-level limits below: even if the shape
 * grows more fields later, the whole stored blob must stay small. Comfortably
 * above what a legitimate v1 document (a handful of enum values plus one
 * URL) could ever reach.
 */
const MAX_SERIALIZED_BYTES = 4000;

const documentationUrlField = z
  .string()
  .trim()
  .max(MAX_DOCUMENTATION_URL_LENGTH, {
    error: `Documentation URL must be ${MAX_DOCUMENTATION_URL_LENGTH} characters or fewer.`,
  })
  .transform((value) => (value === "" ? undefined : value))
  .optional()
  .refine(
    (value) => {
      if (value === undefined) return true;
      try {
        // Only https — this is a link a browser will render and a human
        // will click, never a URL the server fetches, but a bare string
        // still shouldn't be able to smuggle a `javascript:` URI into a
        // rendered `<a href>`.
        return new URL(value).protocol === "https:";
      } catch {
        return false;
      }
    },
    { error: "Documentation URL must be a valid https:// URL." },
  );

/**
 * The part of the Agent Card an owner actually writes. Everything else in
 * the served document (name, description, capabilities, authentication
 * type) is derived from the agent's own existing columns at read time —
 * see `buildAgentCard` — so there's nothing here that duplicates data that
 * already has a column, and nothing here can drift out of sync with it.
 */
export const agentCardInputSchema = z
  .object({
    modalities: z
      .array(z.enum(AGENT_CARD_MODALITIES))
      .max(AGENT_CARD_MODALITIES.length, {
        error: "Duplicate or unrecognized modality.",
      })
      .refine((values) => new Set(values).size === values.length, {
        error: "Modalities must not repeat.",
      })
      .default([]),
    interactionType: z.enum(AGENT_CARD_INTERACTION_TYPES).nullable().default(null),
    documentationUrl: documentationUrlField,
  })
  .superRefine((value, ctx) => {
    const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
    if (bytes > MAX_SERIALIZED_BYTES) {
      ctx.addIssue({
        code: "custom",
        message: "Agent Card data is too large.",
      });
    }
  });

export type AgentCardInput = z.infer<typeof agentCardInputSchema>;

/**
 * FormData carries `agentCardInteractionType` as `""` for "not specified" —
 * normalize that to `null` before validation, matching the schema's own
 * default rather than failing an enum check on an empty string.
 */
export function parseAgentCardFormFields(formData: FormData) {
  const modalities = formData.getAll("agentCardModalities").map(String);
  const interactionTypeRaw = formData.get("agentCardInteractionType");
  const interactionType =
    interactionTypeRaw === null || interactionTypeRaw === ""
      ? null
      : String(interactionTypeRaw);

  return {
    modalities,
    interactionType,
    documentationUrl: formData.get("agentCardDocumentationUrl") ?? undefined,
  };
}

/**
 * What every consumer (dashboard, public profile, Public API) actually
 * sees. Deliberately excludes `endpointUrl` and every other owner-only or
 * internal field — nothing here comes from anywhere but this function, so
 * there's exactly one place that decides what's safe to expose.
 */
export type AgentCardDocument = {
  schemaVersion: string;
  name: string;
  description: string | null;
  capabilities: string[];
  authentication: { type: string };
  interfaces: {
    modalities: AgentCardModality[];
    interactionType: AgentCardInteractionType | null;
  };
  documentationUrl: string | null;
};

const EMPTY_CARD_INPUT: AgentCardInput = {
  modalities: [],
  interactionType: null,
  documentationUrl: undefined,
};

/**
 * The stored `agent_card` column is `jsonb not null default '{}'`, so every
 * legacy agent (registered before this feature existed) already has a row
 * — just an empty object with nothing set. Parsing it through the same
 * schema a write would use means a legacy or hand-edited/corrupt blob falls
 * back to "nothing extra was ever set" instead of throwing and breaking a
 * page render.
 */
function parseStoredAgentCard(raw: unknown): AgentCardInput {
  const parsed = agentCardInputSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : EMPTY_CARD_INPUT;
}

export function buildAgentCard(agent: {
  name: string;
  description: string | null;
  capabilityTags: string[];
  authType: string;
  agentCard: unknown;
}): AgentCardDocument {
  const stored = parseStoredAgentCard(agent.agentCard);
  return {
    schemaVersion: AGENT_CARD_SCHEMA_VERSION,
    name: agent.name,
    description: agent.description,
    capabilities: agent.capabilityTags,
    authentication: { type: agent.authType },
    interfaces: {
      modalities: stored.modalities,
      interactionType: stored.interactionType,
    },
    documentationUrl: stored.documentationUrl ?? null,
  };
}
