import "server-only";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { agents } from "@/lib/db/schema";
import {
  withUserContext,
  withAnonContext,
  withDbErrorNormalization,
  type AppDatabase,
} from "@/lib/db/rls";
import { slugify, type AgentInput } from "@/lib/validation/agent";
import { DEFAULT_AUTH_HEADER_NAME } from "@/lib/validation/agent-constants";
import { AGENT_CARD_SCHEMA_VERSION } from "@/lib/validation/agent-card";
import { AppError, ErrorCode } from "@/lib/errors";
import { env } from "@/lib/config.server";
import { encryptAgentCredential } from "@/lib/security/agent-credentials";

export type Agent = typeof agents.$inferSelect;

const AGENT_NOT_FOUND = "No agent found with that id, or you don't own it.";
const MAX_SLUG_ATTEMPTS = 50;
const POSTGRES_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === POSTGRES_UNIQUE_VIOLATION
  );
}

async function uniqueSlug(tx: AppDatabase, base: string): Promise<string> {
  return withDbErrorNormalization(async () => {
    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
      const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
      const existing = await tx
        .select({ id: agents.id })
        .from(agents)
        .where(eq(agents.slug, candidate))
        .limit(1);
      if (existing.length === 0) return candidate;
    }
    throw new AppError(
      ErrorCode.CONFLICT,
      "Couldn't generate a unique identifier for this agent name — try a more distinctive name.",
    );
  });
}

function agentColumns(input: AgentInput) {
  const card = input.agentCard;
  return {
    name: input.name,
    description: input.description ?? null,
    endpointUrl: input.endpointUrl,
    version: input.version ?? null,
    capabilityTags: input.capabilities,
    authType: input.authType,
    // The card's own `documentationUrl`/`interactionType`/`modalities` are
    // the only fields ever stored here — everything else in the served
    // Agent Card document (name, description, capabilities, auth type) is
    // derived from the columns above at read time by `buildAgentCard`,
    // never duplicated into this JSONB blob.
    agentCard: {
      modalities: card?.modalities ?? [],
      interactionType: card?.interactionType ?? null,
      documentationUrl: card?.documentationUrl,
    },
    // Always server-set to the current version — a write never trusts a
    // client-supplied schema version (there isn't even a field for one).
    agentCardSchemaVersion: AGENT_CARD_SCHEMA_VERSION,
  };
}

/**
 * Credential columns for a brand-new agent. Separate from `agentColumns`
 * because, unlike every other field, whether a credential is required (and
 * what "blank" means) depends on `authType` — there's no existing stored
 * state to fall back on yet, so a blank credential here is always an error
 * for an authenticated mode, never "keep the old value" (there is none).
 */
function buildCredentialColumnsForCreate(input: AgentInput) {
  if (input.authType === "none") {
    return { authCredentialCiphertext: null, authHeaderName: null };
  }
  if (!input.authCredential) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      `A credential is required when authType is "${input.authType}".`,
    );
  }
  return {
    authCredentialCiphertext: encryptAgentCredential(
      input.authCredential,
      env.AGENT_CREDENTIAL_ENCRYPTION_KEY,
    ),
    authHeaderName:
      input.authType === "api_key"
        ? (input.authHeaderName ?? DEFAULT_AUTH_HEADER_NAME)
        : null,
  };
}

type CurrentCredentialState = Pick<
  Agent,
  "authType" | "authCredentialCiphertext" | "authHeaderName"
>;

/**
 * Credential columns for an update, given what's currently stored. Unlike
 * `agentColumns` (always a full replace), this returns a *partial* object —
 * a key that's omitted here is left out of the eventual `.set()` call
 * entirely, which for Drizzle means the column is untouched, not nulled.
 * That's how "leave the credential field blank to keep the existing value"
 * is implemented: the preserve path simply never mentions the column.
 *
 * Rules (all per the approved spec, not inferred):
 *   - authType "none": clear both columns.
 *   - authType bearer/api_key + a new credential supplied: always encrypt
 *     and replace, whether or not the mode changed.
 *   - authType bearer/api_key + blank credential, but the mode *changed*
 *     from what's stored (e.g. bearer -> api_key): a new credential is
 *     required — the old one is never silently reused across auth modes.
 *   - authType bearer/api_key + blank credential + same mode + nothing
 *     stored yet: a new credential is required (nothing to preserve).
 *   - authType bearer/api_key + blank credential + same mode + something
 *     already stored: preserve the ciphertext untouched. The header name
 *     may still be updated independently (renaming it doesn't require
 *     rotating the credential), defaulting only if nothing was stored.
 */
function resolveCredentialColumnsForUpdate(
  input: AgentInput,
  current: CurrentCredentialState,
) {
  if (input.authType === "none") {
    return { authCredentialCiphertext: null, authHeaderName: null };
  }

  if (input.authCredential) {
    return {
      authCredentialCiphertext: encryptAgentCredential(
        input.authCredential,
        env.AGENT_CREDENTIAL_ENCRYPTION_KEY,
      ),
      authHeaderName:
        input.authType === "api_key"
          ? (input.authHeaderName ?? DEFAULT_AUTH_HEADER_NAME)
          : null,
    };
  }

  const switchedAuthenticatedMode = current.authType !== input.authType;
  const hasStoredCredential = Boolean(current.authCredentialCiphertext);

  if (switchedAuthenticatedMode || !hasStoredCredential) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      switchedAuthenticatedMode
        ? "Switching authentication type requires a new credential."
        : `A credential is required when authType is "${input.authType}".`,
    );
  }

  if (input.authType !== "api_key") {
    return {};
  }
  return {
    authHeaderName:
      input.authHeaderName ?? current.authHeaderName ?? DEFAULT_AUTH_HEADER_NAME,
  };
}

/**
 * Every function below scopes its query by `ownerId` in the `WHERE` clause
 * (application-level authorization) *and* runs inside `withUserContext`, so
 * Postgres's own RLS policies (supabase/migrations/0001_rls_and_triggers.sql)
 * enforce the same boundary a second, independent way. `ownerId` must come
 * from a verified session (`verifySession()`), never client input.
 */

export async function createAgent(
  db: AppDatabase,
  ownerId: string,
  input: AgentInput,
): Promise<Agent> {
  try {
    // Slugs are unique across every agent, not just this owner's — the
    // availability check has to see the whole table, so it deliberately
    // runs before (outside) the RLS-scoped transaction below, which would
    // otherwise only see this owner's own rows and could hand out a slug
    // someone else already has.
    const slug = await uniqueSlug(db, slugify(input.name));

    return await withUserContext(db, ownerId, async (tx) => {
      const [agent] = await tx
        .insert(agents)
        .values({
          ownerId,
          slug,
          ...agentColumns(input),
          ...buildCredentialColumnsForCreate(input),
        })
        .returning();
      return agent;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(
        ErrorCode.CONFLICT,
        "An agent with a very similar name already exists on your account.",
      );
    }
    throw error;
  }
}

export async function listAgentsForOwner(
  db: AppDatabase,
  ownerId: string,
): Promise<Agent[]> {
  return withUserContext(db, ownerId, (tx) =>
    tx
      .select()
      .from(agents)
      .where(eq(agents.ownerId, ownerId))
      .orderBy(desc(agents.createdAt)),
  );
}

export async function getOwnedAgent(
  db: AppDatabase,
  ownerId: string,
  agentId: string,
): Promise<Agent> {
  return withUserContext(db, ownerId, async (tx) => {
    const [agent] = await tx
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.ownerId, ownerId)))
      .limit(1);
    if (!agent) throw new AppError(ErrorCode.NOT_FOUND, AGENT_NOT_FOUND);
    return agent;
  });
}

/** Same as `getOwnedAgent`, keyed by slug — for the dashboard's readable /dashboard/agents/{slug} route. */
export async function getOwnedAgentBySlug(
  db: AppDatabase,
  ownerId: string,
  slug: string,
): Promise<Agent> {
  return withUserContext(db, ownerId, async (tx) => {
    const [agent] = await tx
      .select()
      .from(agents)
      .where(and(eq(agents.slug, slug), eq(agents.ownerId, ownerId)))
      .limit(1);
    if (!agent) throw new AppError(ErrorCode.NOT_FOUND, AGENT_NOT_FOUND);
    return agent;
  });
}

export async function updateOwnedAgent(
  db: AppDatabase,
  ownerId: string,
  agentId: string,
  input: AgentInput,
): Promise<Agent> {
  try {
    return await withUserContext(db, ownerId, async (tx) => {
      // Credential preserve/replace/clear semantics need to know what's
      // *currently* stored, so this reads the row first, inside the same
      // transaction/RLS context as the update that follows — a non-owner
      // sees no row here for the same reason they'd see no row on the
      // update below, and gets the same NOT_FOUND either way.
      const [current] = await tx
        .select({
          authType: agents.authType,
          authCredentialCiphertext: agents.authCredentialCiphertext,
          authHeaderName: agents.authHeaderName,
        })
        .from(agents)
        .where(and(eq(agents.id, agentId), eq(agents.ownerId, ownerId)))
        .limit(1);
      if (!current) throw new AppError(ErrorCode.NOT_FOUND, AGENT_NOT_FOUND);

      const [agent] = await tx
        .update(agents)
        .set({
          ...agentColumns(input),
          ...resolveCredentialColumnsForUpdate(input, current),
          updatedAt: new Date(),
        })
        .where(and(eq(agents.id, agentId), eq(agents.ownerId, ownerId)))
        .returning();
      if (!agent) throw new AppError(ErrorCode.NOT_FOUND, AGENT_NOT_FOUND);
      return agent;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(
        ErrorCode.CONFLICT,
        "An agent with a very similar name already exists on your account.",
      );
    }
    throw error;
  }
}

export async function deleteOwnedAgent(
  db: AppDatabase,
  ownerId: string,
  agentId: string,
): Promise<void> {
  await withUserContext(db, ownerId, async (tx) => {
    const deleted = await tx
      .delete(agents)
      .where(and(eq(agents.id, agentId), eq(agents.ownerId, ownerId)))
      .returning({ id: agents.id });
    if (deleted.length === 0) {
      throw new AppError(ErrorCode.NOT_FOUND, AGENT_NOT_FOUND);
    }
  });
}

/**
 * Moves an owned agent out of `draft` into `active` — the one flag that
 * simultaneously (a) makes it visible under RLS's "public reads active
 * public agents" policy and (b) makes it eligible for the pull-monitoring
 * cron, since `claimDueAgents` (src/lib/db/queries/health-checks.ts) only
 * ever claims `active` agents. There is deliberately no automatic path to
 * this state — every agent starts `draft` (the column's own default) and
 * stays invisible/unmonitored until its owner explicitly activates it.
 * Scoped by owner exactly like every other write here; a non-owner gets
 * the same NOT_FOUND every other function in this file uses to avoid
 * leaking existence.
 */
export async function activateOwnedAgent(
  db: AppDatabase,
  ownerId: string,
  agentId: string,
): Promise<Agent> {
  return withUserContext(db, ownerId, async (tx) => {
    const [agent] = await tx
      .update(agents)
      .set({ lifecycleStatus: "active", updatedAt: new Date() })
      .where(and(eq(agents.id, agentId), eq(agents.ownerId, ownerId)))
      .returning();
    if (!agent) throw new AppError(ErrorCode.NOT_FOUND, AGENT_NOT_FOUND);
    return agent;
  });
}

/**
 * Marks an owned agent alive right now, using the server's own clock — the
 * timestamp is never taken from the caller, so there's no way for a client
 * to backdate or future-date a heartbeat. The `slug`+`ownerId` match in the
 * `WHERE` clause is also the entire ownership check: a heartbeat for an
 * agent owned by someone else finds no row and comes back NOT_FOUND, the
 * same "don't leak existence" shape every other owner-scoped query here
 * uses.
 */
export async function recordAgentHeartbeatBySlug(
  db: AppDatabase,
  ownerId: string,
  slug: string,
  at: Date,
): Promise<Agent> {
  return withUserContext(db, ownerId, async (tx) => {
    const [agent] = await tx
      .update(agents)
      .set({ lastHeartbeatAt: at })
      .where(and(eq(agents.slug, slug), eq(agents.ownerId, ownerId)))
      .returning();
    if (!agent) throw new AppError(ErrorCode.NOT_FOUND, AGENT_NOT_FOUND);
    return agent;
  });
}

/** Public agent profile lookup — no signed-in user, only public+active agents are visible. */
export async function getPublicAgentBySlug(
  db: AppDatabase,
  slug: string,
): Promise<Agent> {
  return withAnonContext(db, async (tx) => {
    const [agent] = await tx
      .select()
      .from(agents)
      .where(
        and(
          eq(agents.slug, slug),
          eq(agents.visibility, "public"),
          eq(agents.lifecycleStatus, "active"),
        ),
      )
      .limit(1);
    if (!agent) {
      throw new AppError(
        ErrorCode.NOT_FOUND,
        "No agent found at this address.",
      );
    }
    return agent;
  });
}

export type PublicAgentsPage = {
  agents: Agent[];
  /** Opaque — pass back as-is in the next request's `cursor`. Null once there's nothing further. */
  nextCursor: string | null;
};

/**
 * Cursor encodes the last row's (created_at, id) — a compound key, since
 * two agents can share a created_at down to the millisecond under bulk
 * inserts and id alone (a random UUID) carries no ordering. Opaque to
 * callers on purpose: this is an implementation detail, not an API
 * contract, and can change without becoming a breaking change.
 */
function encodeAgentsCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, "utf8").toString(
    "base64url",
  );
}

function decodeAgentsCursor(
  cursor: string,
): { createdAt: Date; id: string } | null {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const separatorIndex = decoded.indexOf("|");
    if (separatorIndex === -1) return null;
    const iso = decoded.slice(0, separatorIndex);
    const id = decoded.slice(separatorIndex + 1);
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime()) || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/**
 * Every public+active agent, newest first — the Public API's discovery
 * listing. No signed-in caller, so this runs as Supabase's anonymous role,
 * same as `getPublicAgentBySlug`; RLS's public-read policy is the real
 * gate, this query just adds the same filter explicitly too.
 */
export async function listPublicAgents(
  db: AppDatabase,
  options: { limit: number; cursor?: string | null },
): Promise<PublicAgentsPage> {
  const { limit, cursor } = options;

  let cursorCondition: ReturnType<typeof or> | undefined;
  if (cursor) {
    const decoded = decodeAgentsCursor(cursor);
    if (!decoded) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid pagination cursor.");
    }
    cursorCondition = or(
      lt(agents.createdAt, decoded.createdAt),
      and(eq(agents.createdAt, decoded.createdAt), lt(agents.id, decoded.id)),
    );
  }

  return withAnonContext(db, async (tx) => {
    const rows = await tx
      .select()
      .from(agents)
      .where(
        and(
          eq(agents.visibility, "public"),
          eq(agents.lifecycleStatus, "active"),
          cursorCondition,
        ),
      )
      .orderBy(desc(agents.createdAt), desc(agents.id))
      // Fetch one extra row, purely to learn whether a next page exists.
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];

    return {
      agents: page,
      nextCursor: hasMore && last ? encodeAgentsCursor(last.createdAt, last.id) : null,
    };
  });
}
