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
import { AGENT_CARD_SCHEMA_VERSION } from "@/lib/validation/agent-card";
import { AppError, ErrorCode } from "@/lib/errors";

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
        .values({ ownerId, slug, ...agentColumns(input) })
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
      const [agent] = await tx
        .update(agents)
        .set({ ...agentColumns(input), updatedAt: new Date() })
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
