import {
  pgSchema,
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Reference-only stand-in for Supabase's `auth.users` table, so `profiles`
 * can declare a real foreign key to it. `drizzle.config.ts` restricts
 * migrations to the `public` schema, so drizzle-kit never tries to create or
 * alter this table — it only uses it to resolve the FK on `profiles`.
 */
const authUsers = pgSchema("auth").table("users", {
  id: uuid("id").primaryKey(),
});

export const agentVisibility = pgEnum("agent_visibility", [
  "public",
  "unlisted",
]);
export const agentLifecycle = pgEnum("agent_lifecycle", [
  "draft",
  "pending_verification",
  "active",
  "deactivated",
]);
export const agentStatus = pgEnum("agent_status", [
  "unknown",
  "healthy",
  "degraded",
  "down",
]);
// How a caller authenticates to the agent's own endpoint — not how the
// agent authenticates to AgentTrust. Registration-time metadata only; no
// credentials are collected or stored here.
export const agentAuthType = pgEnum("agent_auth_type", [
  "none",
  "api_key",
  "bearer",
  "oauth2",
  "custom",
]);
// How an agent row came to exist. "owner_registered" (the only kind until
// now) always has a real owner_id. "externally_observed" is a row AgentTrust
// itself discovered from a public registry, on nobody's behalf — it always
// has owner_id NULL (enforced by the agents_source_owner_consistency check
// below, not just by convention) and can never be claimed/verified through
// the existing owner-scoped verification actions, which require a session's
// ownerId to match a non-null row.
export const agentSource = pgEnum("agent_source", [
  "owner_registered",
  "externally_observed",
]);
// The technical category a single health check outcome falls into — distinct
// from `success` (a plain boolean) so the dashboard and the status-derivation
// logic can tell *why* a check failed, not just that it did.
export const healthCheckStatus = pgEnum("health_check_status", [
  "success",
  "http_error",
  "timeout",
  "dns_error",
  "tls_error",
  "connection_error",
  "ssrf_blocked",
  "unknown_error",
]);

export const profiles = pgTable("profiles", {
  id: uuid("id")
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // NULL only for source = "externally_observed" — see agentSource above
    // and the agents_source_owner_consistency check below.
    ownerId: uuid("owner_id").references(() => profiles.id, {
      onDelete: "cascade",
    }),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    capabilityTags: text("capability_tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    version: text("version"),
    endpointUrl: text("endpoint_url").notNull(),
    // `normalizeEndpointUrlForLookup(endpointUrl)`, stored so the public
    // endpoint-URL lookup can be one indexed equality match instead of
    // normalizing every agent's URL in application code. Always written by
    // application code on every path that writes `endpointUrl` (the
    // normalization is WHATWG URL parsing, which SQL can't reproduce, so
    // this can't be a generated column). NULL means "can't be matched" —
    // either unparseable/over-long (exactly what the function returns null
    // for) or a row the backfill hasn't reached yet; NULL never matches a
    // lookup. Not unique: several agents may share an endpoint.
    endpointUrlNormalized: text("endpoint_url_normalized"),
    authType: agentAuthType("auth_type").notNull().default("none"),
    // AES-256-GCM ciphertext (iv + authTag + ciphertext, all base64-encoded
    // and concatenated — see src/lib/security/agent-credentials.ts) of the
    // bearer token or API key value used to authenticate to this agent's own
    // endpoint during monitoring. Never the plaintext. Null when authType is
    // "none" (or unset). Must never appear in any public-facing
    // serialization — see toPublicAgentJson / buildAgentCard.
    authCredentialCiphertext: text("auth_credential_ciphertext"),
    // Header name used to send the credential when authType is "api_key",
    // e.g. "X-API-Key" (the default). Not sensitive on its own — safe to
    // read back, just not the credential value.
    authHeaderName: text("auth_header_name"),
    // Domain/endpoint-ownership verification (see src/lib/verification/ownership.ts).
    // Unlike authCredentialCiphertext this is NOT an encrypted secret — it's
    // a random challenge value the owner is meant to *publish* at their own
    // well-known URL, so storing it in plaintext is correct, not a shortcut.
    // It must still never appear in public-facing serialization (the point
    // is that AgentTrust vouches for the *result* of the check, not that the
    // token itself is secret) — see toPublicAgentJson.
    ownershipVerificationToken: text("ownership_verification_token"),
    // Null until a check has actually succeeded. This (not lifecycleStatus)
    // is the public trust signal: an agent can be "active" (monitored) long
    // before anyone has proven they control its endpoint.
    ownershipVerifiedAt: timestamp("ownership_verified_at", {
      withTimezone: true,
    }),
    // Server-side throttle for the "Check now" action — set on every
    // attempt (successful or not), so a slow/failing endpoint can't be used
    // to bypass the cooldown by triggering repeated outbound fetches. See
    // OWNERSHIP_CHECK_COOLDOWN_SECONDS in src/lib/verification/ownership.ts.
    ownershipLastCheckedAt: timestamp("ownership_last_checked_at", {
      withTimezone: true,
    }),
    healthCheckUrl: text("health_check_url"),
    mcpServerUrl: text("mcp_server_url"),
    repoUrl: text("repo_url"),
    contactEmail: text("contact_email"),
    // Structured, machine-readable capabilities beyond what has its own
    // column — see src/lib/validation/agent-card.ts for the schema and
    // `buildAgentCard` for how this merges with the columns above into the
    // full served document. Left untyped here (not `.$type<AgentCardInput>()`)
    // deliberately: the real safety boundary is the zod parse every reader
    // and writer already goes through, not a static column type — and
    // keeping the JS-side `.default({})` byte-identical to the value
    // already baked into the applied migration avoids drizzle-kit ever
    // seeing (nonexistent) drift to "fix" with a new migration.
    agentCard: jsonb("agent_card").notNull().default({}),
    agentCardSchemaVersion: text("agent_card_schema_version")
      .notNull()
      .default("1.0"),
    visibility: agentVisibility("visibility").notNull().default("public"),
    lifecycleStatus: agentLifecycle("lifecycle_status")
      .notNull()
      .default("draft"),
    monitoringMode: text("monitoring_mode").notNull().default("pull"),
    checkIntervalSeconds: integer("check_interval_seconds")
      .notNull()
      .default(300),
    // Cached/derived by the (future) monitoring cron — not written by users.
    currentStatus: agentStatus("current_status").notNull().default("unknown"),
    nextCheckAt: timestamp("next_check_at", { withTimezone: true }),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    source: agentSource("source").notNull().default("owner_registered"),
    // The public registry's own id for this agent (e.g. the A2A Registry's
    // "id" field) — an idempotency key so re-running an importer can never
    // insert a second row for the same external listing. NULL for
    // owner-registered agents.
    externalRegistryId: text("external_registry_id"),
    // When AgentTrust's own importer first discovered this agent. NULL for
    // owner-registered agents (they have createdAt for that already).
    discoveredAt: timestamp("discovered_at", { withTimezone: true }),
  },
  (table) => [
    index("agents_owner_idx").on(table.ownerId),
    index("agents_visibility_status_idx").on(
      table.visibility,
      table.lifecycleStatus,
    ),
    // Deliberately non-unique and not partial: the public lookup filters
    // visibility/lifecycle on top of it, and duplicate endpoints are legal.
    index("agents_endpoint_url_normalized_idx").on(table.endpointUrlNormalized),
    uniqueIndex("agents_external_registry_id_idx")
      .on(table.externalRegistryId)
      .where(sql`${table.externalRegistryId} is not null`),
    check(
      "monitoring_mode_valid",
      sql`${table.monitoringMode} in ('pull','push')`,
    ),
    check("check_interval_floor", sql`${table.checkIntervalSeconds} >= 60`),
    check("endpoint_is_https", sql`${table.endpointUrl} ~ '^https://'`),
    // A hard DB-level guarantee (not just an app-level convention) that an
    // externally-observed agent can never carry a real owner, and that an
    // owner-registered agent always does — see agentSource above.
    check(
      "agents_source_owner_consistency",
      sql`(${table.source} = 'owner_registered' and ${table.ownerId} is not null) or (${table.source} = 'externally_observed' and ${table.ownerId} is null)`,
    ),
    check(
      "agents_external_source_has_registry_id",
      sql`${table.source} = 'owner_registered' or ${table.externalRegistryId} is not null`,
    ),
  ],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => agents.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    // Shown in the UI for identification, e.g. "at_live_8f2c…".
    keyPrefix: text("key_prefix").notNull(),
    // HMAC-SHA256(raw key, server pepper) — the raw key is never stored.
    keyHash: text("key_hash").notNull().unique(),
    scopes: text("scopes")
      .array()
      .notNull()
      .default(sql`'{read}'::text[]`),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("api_keys_owner_idx").on(table.ownerId)],
);

export const healthChecks = pgTable(
  "health_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    checkedAt: timestamp("checked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // "check type": how the signal reached AgentTrust — pull (we probed the
    // agent) vs. push (the agent reported in). Phase 3 only ever writes 'pull'.
    method: text("method").notNull(),
    status: healthCheckStatus("status").notNull(),
    success: boolean("success").notNull(),
    latencyMs: integer("latency_ms"),
    statusCode: integer("status_code"),
    // Machine-readable cause, e.g. "ETIMEDOUT", "ENOTFOUND", "HTTP_5XX",
    // "SSRF_BLOCKED" — for filtering/debugging, distinct from the
    // human-readable (and pre-sanitized) errorMessage below.
    errorCode: text("error_code"),
    // Only ever set to a message that's already been through
    // sanitizeErrorMessage() — never a raw exception string, which could
    // contain internal hostnames, ports, or stack detail.
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("health_checks_agent_time_idx").on(
      table.agentId,
      table.checkedAt.desc(),
    ),
    index("health_checks_checked_at_idx").on(table.checkedAt),
    check("health_check_method_valid", sql`${table.method} in ('pull','push')`),
  ],
);

export const incidents = pgTable(
  "incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    severity: text("severity").notNull(),
    triggerCheckId: uuid("trigger_check_id").references(() => healthChecks.id),
    summary: text("summary"),
  },
  (table) => [
    index("incidents_agent_idx").on(table.agentId),
    check(
      "incident_severity_valid",
      sql`${table.severity} in ('degraded','down')`,
    ),
  ],
);

export const reliabilityScores = pgTable(
  "reliability_scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    computedAt: timestamp("computed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    score: numeric("score", { precision: 5, scale: 2 }).notNull(),
    uptimeSubscore: numeric("uptime_subscore", {
      precision: 5,
      scale: 2,
    }).notNull(),
    latencySubscore: numeric("latency_subscore", {
      precision: 5,
      scale: 2,
    }).notNull(),
    consistencySubscore: numeric("consistency_subscore", {
      precision: 5,
      scale: 2,
    }).notNull(),
    incidentSubscore: numeric("incident_subscore", {
      precision: 5,
      scale: 2,
    }).notNull(),
    formulaVersion: text("formula_version").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("scores_agent_time_idx").on(table.agentId, table.computedAt.desc()),
  ],
);

export const usageCounters = pgTable(
  "usage_counters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    apiKeyId: uuid("api_key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "cascade" }),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    requestCount: integer("request_count").notNull().default(0),
  },
  (table) => [
    uniqueIndex("usage_counters_key_window_idx").on(
      table.apiKeyId,
      table.windowStart,
    ),
  ],
);

// Anonymous per-caller rate limiting for unauthenticated MCP tools (e.g.
// check_agent_trust) — deliberately NOT the same table as usageCounters,
// which is hard-tied to a real api_key row and cannot represent "no key at
// all". No FK to anything: an anonymous caller has no account to reference.
// ipHash is a SHA-256 hash of the caller's IP (see src/lib/api/anonymous-rate-limit.ts)
// — the raw IP is never stored. The sentinel value GLOBAL_RATE_LIMIT_KEY
// (see that same file) reuses this table for the aggregate safety cap
// across all anonymous callers, rather than adding a second table.
export const anonymousRateLimits = pgTable(
  "anonymous_rate_limits",
  {
    ipHash: text("ip_hash").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    requestCount: integer("request_count").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.ipHash, table.windowStart] }),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => profiles.id),
    agentId: uuid("agent_id").references(() => agents.id),
    action: text("action").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("audit_log_agent_idx").on(table.agentId, table.createdAt.desc()),
  ],
);
