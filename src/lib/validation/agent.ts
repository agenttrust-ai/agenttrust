import "server-only";
import { z } from "zod";
import { checkSafeAgentUrl } from "@/lib/security/url-safety";
import { AGENT_AUTH_TYPES } from "@/lib/validation/agent-constants";
import { agentCardInputSchema, parseAgentCardFormFields } from "@/lib/validation/agent-card";

export { AGENT_AUTH_TYPES };

const capabilityTag = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(
    /^[a-z0-9][a-z0-9-]*$/,
    "Use lowercase letters, numbers, and hyphens.",
  );

const endpointUrlField = z
  .string()
  .trim()
  .min(1, { error: "Enter the agent's endpoint URL." })
  .superRefine((value, ctx) => {
    const result = checkSafeAgentUrl(value);
    if (!result.safe) {
      ctx.addIssue({ code: "custom", message: result.message });
    }
  });

export const agentInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, { error: "Name must be at least 2 characters." })
    .max(100, { error: "Name must be 100 characters or fewer." }),
  description: z
    .string()
    .trim()
    .max(2000, { error: "Description must be 2000 characters or fewer." })
    .transform((value) => (value === "" ? undefined : value))
    .optional(),
  endpointUrl: endpointUrlField,
  version: z
    .string()
    .trim()
    .max(50, { error: "Version must be 50 characters or fewer." })
    .transform((value) => (value === "" ? undefined : value))
    .optional(),
  capabilities: z
    .array(capabilityTag)
    .max(20, { error: "Use at most 20 capability tags." })
    .default([]),
  authType: z.enum(AGENT_AUTH_TYPES, {
    error: "Choose a valid authentication type.",
  }),
  // Optional so every existing construction of an `AgentInput` (tests,
  // callers written before this field existed) keeps compiling — omitting
  // it entirely is treated the same as an all-defaults Agent Card by
  // `agentColumns` in src/lib/db/queries/agents.ts.
  agentCard: agentCardInputSchema.optional(),
});

export type AgentInput = z.infer<typeof agentInputSchema>;

/**
 * Registration form fields arrive as FormData (a plain form submit), so
 * capabilities come in as one comma/newline separated string rather than an
 * array — this turns that into the shape `agentInputSchema` expects.
 */
export function parseAgentFormData(formData: FormData) {
  const capabilitiesRaw = String(formData.get("capabilities") ?? "");
  const capabilities = capabilitiesRaw
    .split(/[,\n]/)
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);

  // FormData.get() returns null (not undefined) for a missing field, and
  // zod's .optional() only treats `undefined` as absent — normalize here so
  // an omitted optional field doesn't fail validation as a type mismatch.
  const field = (key: string) => formData.get(key) ?? undefined;

  return agentInputSchema.safeParse({
    name: field("name"),
    description: field("description"),
    endpointUrl: field("endpointUrl"),
    version: field("version"),
    capabilities,
    authType: field("authType"),
    agentCard: parseAgentCardFormFields(formData),
  });
}

/** Turns "My Cool Agent" into a URL-safe, unique-per-owner-ish slug base. */
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "agent";
}
