import "server-only";
import { and, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
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
import {
  buildVerificationUrl,
  generateVerificationToken,
  tokenMatches,
  OWNERSHIP_CHECK_COOLDOWN_SECONDS,
} from "@/lib/verification/ownership";
import { fetchOwnershipVerificationFile } from "@/lib/monitoring/safe-fetch";

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
 * Endpoint-ownership verification proves control of one specific origin —
 * it says nothing about any *other* origin. If the owner changes the
 * endpoint URL, a previously-verified (or in-progress) check for the old
 * origin must not silently carry over to the new one; that would let
 * anyone verify once against a domain they control and then repoint the
 * agent at an arbitrary different endpoint while keeping the "verified"
 * badge. Comparing the full URL (not just the origin) is deliberately
 * stricter than necessary for the security property alone, but simpler to
 * reason about and still correct: a path-only change means AgentTrust
 * hasn't re-confirmed anything about how *this* URL behaves either.
 */
function resolveOwnershipColumnsForUpdate(
  input: AgentInput,
  current: Pick<Agent, "endpointUrl">,
) {
  if (input.endpointUrl !== current.endpointUrl) {
    return { ownershipVerificationToken: null, ownershipVerifiedAt: null };
  }
  return {};
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
          endpointUrl: agents.endpointUrl,
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
          ...resolveOwnershipColumnsForUpdate(input, current),
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
 * Begins (or re-fetches) endpoint-ownership verification for an owned
 * agent: generates a random challenge token the first time this is called
 * and stores it, so the owner's dashboard can show them what to publish.
 * Idempotent — calling this again once a token already exists just returns
 * the current row unchanged, so re-visiting the page never invalidates a
 * token the owner may have already published.
 */
export async function startOwnershipVerification(
  db: AppDatabase,
  ownerId: string,
  agentId: string,
): Promise<Agent> {
  const agent = await getOwnedAgent(db, ownerId, agentId);
  if (agent.ownershipVerificationToken) return agent;

  return withUserContext(db, ownerId, async (tx) => {
    const [updated] = await tx
      .update(agents)
      .set({
        ownershipVerificationToken: generateVerificationToken(),
        updatedAt: new Date(),
      })
      .where(and(eq(agents.id, agentId), eq(agents.ownerId, ownerId)))
      .returning();
    if (!updated) throw new AppError(ErrorCode.NOT_FOUND, AGENT_NOT_FOUND);
    return updated;
  });
}

/**
 * Performs one endpoint-ownership check: fetches the agent's well-known
 * verification file and compares it against the stored token. The network
 * call deliberately happens *outside* any `withUserContext` transaction —
 * `getOwnedAgent` (a full, fast, ownership-checked read) resolves first,
 * then the slow outbound fetch runs with no DB transaction held open across
 * it, then a short transaction records the result. This mirrors why
 * `claimDueAgents`/`run-batch.ts` never hold a lock across a health check's
 * network I/O either.
 *
 * Throttled to at most one attempt per `OWNERSHIP_CHECK_COOLDOWN_SECONDS`
 * per agent — this is the only place in the app that lets an authenticated
 * account make AgentTrust's own servers fetch an arbitrary caller-chosen
 * HTTPS URL on demand, so unlike the Public API (rate-limited per API key)
 * this needs its own server-side throttle regardless of how fast someone
 * clicks "Check now". The claim is a single atomic `UPDATE ... WHERE
 * ownership_last_checked_at IS NULL OR < cutoff`, not a separate
 * read-then-write — closing the race where two concurrent attempts could
 * otherwise both pass a plain check before either one persists. The
 * timestamp is claimed *before* the outbound fetch and stays claimed
 * whether the check succeeds or fails, so a slow or consistently-failing
 * endpoint can't be used to bypass the cooldown by triggering repeated
 * fetches while never reaching the "success" branch.
 *
 * Throws (never silently returns an "unverified" `Agent`) on any failure —
 * throttled, missing token, an unreachable/blocked/oversized endpoint, or a
 * mismatched value — so the caller's error handling is the same shape as
 * every other mutating DAL function here, and a failed check can never be
 * mistaken for a successful (if unverified) read.
 */
export async function checkOwnershipVerification(
  db: AppDatabase,
  ownerId: string,
  agentId: string,
): Promise<Agent> {
  const agent = await getOwnedAgent(db, ownerId, agentId);
  if (!agent.ownershipVerificationToken) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      "Start verification before checking it.",
    );
  }

  const cooldownCutoff = new Date(
    Date.now() - OWNERSHIP_CHECK_COOLDOWN_SECONDS * 1000,
  );
  const claimed = await withUserContext(db, ownerId, async (tx) => {
    const [row] = await tx
      .update(agents)
      .set({ ownershipLastCheckedAt: new Date() })
      .where(
        and(
          eq(agents.id, agentId),
          eq(agents.ownerId, ownerId),
          or(
            isNull(agents.ownershipLastCheckedAt),
            lt(agents.ownershipLastCheckedAt, cooldownCutoff),
          ),
        ),
      )
      .returning({ id: agents.id });
    return row;
  });

  if (!claimed) {
    // Not throttled by coincidence — `agent.ownershipLastCheckedAt` above
    // is exactly the value the failed claim's WHERE clause compared
    // against (nothing else can have changed it between that read and
    // this point except another attempt, which would only ever make the
    // remaining wait longer, never shorter), so it's a safe, accurate
    // basis for the retry-after estimate without a second read.
    const retryAfterSeconds = agent.ownershipLastCheckedAt
      ? Math.max(
          1,
          Math.ceil(
            (agent.ownershipLastCheckedAt.getTime() +
              OWNERSHIP_CHECK_COOLDOWN_SECONDS * 1000 -
              Date.now()) /
              1000,
          ),
        )
      : OWNERSHIP_CHECK_COOLDOWN_SECONDS;
    throw new AppError(
      ErrorCode.RATE_LIMITED,
      `Checking too often — try again in ${retryAfterSeconds}s.`,
      { retryAfterSeconds },
    );
  }

  const verificationUrl = buildVerificationUrl(agent.endpointUrl);
  const result = await fetchOwnershipVerificationFile(verificationUrl);
  if (!result.success) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, result.errorMessage);
  }
  if (!tokenMatches(result.body, agent.ownershipVerificationToken)) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      "The verification file's contents didn't match the expected token.",
    );
  }

  return withUserContext(db, ownerId, async (tx) => {
    const [updated] = await tx
      .update(agents)
      .set({ ownershipVerifiedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(agents.id, agentId), eq(agents.ownerId, ownerId)))
      .returning();
    if (!updated) throw new AppError(ErrorCode.NOT_FOUND, AGENT_NOT_FOUND);
    return updated;
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

const MAX_LOOKUP_URL_LENGTH = 2048;

/**
 * Canonicalizes a URL for exact-match discovery lookups — trailing-slash
 * and scheme/host-casing differences only, never fuzzy matching. Parsing
 * via `URL` already folds scheme and host casing per the WHATWG spec (e.g.
 * `HTTPS://Example.com` and `https://example.com` parse to the same
 * `href`); the one thing it does *not* do is treat a trailing slash on a
 * non-root path as equivalent to the same path without one, so that's
 * stripped explicitly here — applied identically to both the incoming
 * query value and every stored `endpointUrl` being compared against, so
 * "differs only by a trailing slash" means the same thing on both sides.
 * Returns `null` for anything that isn't a parseable URL at all (or is
 * absurdly long) — callers treat that as "can't possibly match anything",
 * not as a validation error, matching how an unknown endpoint is handled.
 */
function normalizeEndpointUrlForLookup(rawUrl: string): string | null {
  if (rawUrl.length === 0 || rawUrl.length > MAX_LOOKUP_URL_LENGTH) return null;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }
  return parsed.toString();
}

/**
 * Every public+active agent, newest first — the Public API's discovery
 * listing. No signed-in caller, so this runs as Supabase's anonymous role,
 * same as `getPublicAgentBySlug`; RLS's public-read policy is the real
 * gate, this query just adds the same filter explicitly too.
 *
 * `options.endpointUrl`, when given, narrows this to agents whose
 * registered endpoint matches it exactly (after the normalization above) —
 * how a caller who only has some agent's invocation URL, not its
 * AgentTrust slug, discovers whether it's registered at all. There's no
 * uniqueness constraint on `endpointUrl` (out of scope for this
 * milestone), so this can legitimately match more than one agent; it's
 * layered as an ordinary extra filter on the exact same query, so it
 * still fully composes with cursor pagination, visibility/lifecycle
 * gating, and the caller's own rate limiting — none of that changes.
 */
export async function listPublicAgents(
  db: AppDatabase,
  options: { limit: number; cursor?: string | null; endpointUrl?: string | null },
): Promise<PublicAgentsPage> {
  const { limit, cursor, endpointUrl } = options;

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
    let endpointUrlCondition: ReturnType<typeof inArray> | undefined;
    if (endpointUrl) {
      const normalizedQuery = normalizeEndpointUrlForLookup(endpointUrl);
      if (!normalizedQuery) {
        return { agents: [], nextCursor: null };
      }

      // No indexable normalized column exists (and adding one is out of
      // this milestone's scope), so at MVP scale this does the match in
      // application code: fetch the small (id, endpointUrl) candidate set
      // already narrowed to public+active, normalize each, and only then
      // fold the matching ids into the real query below as an ordinary
      // `inArray` condition — everything after this point (pagination,
      // ordering, column selection) is the exact same query path every
      // other call to this function goes through.
      const candidates = await tx
        .select({ id: agents.id, endpointUrl: agents.endpointUrl })
        .from(agents)
        .where(
          and(eq(agents.visibility, "public"), eq(agents.lifecycleStatus, "active")),
        );
      const matchedIds = candidates
        .filter((c) => normalizeEndpointUrlForLookup(c.endpointUrl) === normalizedQuery)
        .map((c) => c.id);

      if (matchedIds.length === 0) {
        return { agents: [], nextCursor: null };
      }
      endpointUrlCondition = inArray(agents.id, matchedIds);
    }

    const rows = await tx
      .select()
      .from(agents)
      .where(
        and(
          eq(agents.visibility, "public"),
          eq(agents.lifecycleStatus, "active"),
          cursorCondition,
          endpointUrlCondition,
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
