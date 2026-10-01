import "server-only";
import crypto from "node:crypto";
import { isIP } from "node:net";
import { after } from "next/server";
import { and, count, gte, inArray, lt, sql } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db/rls";
import { trustCheckEvents } from "@/lib/db/schema";
import { extractTrustedClientIp } from "@/lib/api/anonymous-rate-limit";
import { normalizeEndpointUrlForLookup } from "@/lib/db/queries/agents";

/**
 * Privacy-preserving usage telemetry for `check_agent_trust` — how many
 * checks run, from which surface and client family, whether they matched,
 * what the decision was, and which unknown endpoints callers asked about.
 *
 * What is stored, and what never is:
 *   - Never a raw IP, full endpoint URL, query string, fragment, request
 *     body, header value (beyond the user-agent's product token), API key
 *     or credential.
 *   - Matched check: the agent id it resolved to and its decision.
 *   - Unmatched check: a sanitized *public* hostname (nothing for IP
 *     literals, localhost or internal names) plus a keyed hash of the URL
 *     with its query and fragment removed.
 *   - `caller_key`: a keyed hash of the caller's IP that changes every
 *     CALLER_KEY_PERIOD_DAYS, so callers can be counted but not tracked
 *     across periods, and — unlike a plain hash — not reversed without the
 *     key. Deliberately not the anonymous rate limiter's IP hash.
 *
 * Best-effort by construction: recording runs after the response is sent,
 * every step is wrapped, and a failure is logged without detail and
 * dropped. Telemetry can never fail, slow down, or change a trust check —
 * and it never contacts the checked endpoint or triggers crawling,
 * registration or monitoring for an unmatched one.
 */

export type TrustCheckSurface = "mcp" | "web";

/** Hard cap on events recorded per UTC day, across all callers. */
export const TELEMETRY_DAILY_EVENT_CAP = 5_000;
/** Most events recorded per caller per UTC day, so one caller can't dominate the data. */
export const TELEMETRY_PER_CALLER_DAILY_CAP = 50;
/** Events older than this are deleted. */
export const TELEMETRY_RETENTION_DAYS = 90;
/** How long a caller_key stays the same before it rotates. */
export const CALLER_KEY_PERIOD_DAYS = 30;
/** Minimum length for TELEMETRY_HASH_KEY to be used at all. */
export const MIN_TELEMETRY_KEY_LENGTH = 32;

const RETENTION_SWEEP_PROBABILITY = 0.01;
const RETENTION_SWEEP_BATCH = 1_000;
const MAX_CLIENT_FAMILY_LENGTH = 64;
const MAX_HOSTNAME_LENGTH = 253;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Names that are never a public, routable host: RFC 6761/6762 special-use
 * names and common private/internal suffixes.
 */
const NON_PUBLIC_SUFFIXES = [
  "localhost",
  "local",
  "localdomain",
  "internal",
  "intranet",
  "lan",
  "home",
  "home.arpa",
  "corp",
  "private",
  "test",
  "example",
  "invalid",
  "onion",
  "arpa",
];

/**
 * TELEMETRY_HASH_KEY, only if it's long enough to be a real key. Read at
 * call time (not validated at startup), so a missing or malformed value can
 * never break the app — telemetry just records without keyed hashes.
 */
export function telemetryHashKey(): string | null {
  const key = process.env.TELEMETRY_HASH_KEY;
  return key && key.length >= MIN_TELEMETRY_KEY_LENGTH ? key : null;
}

/**
 * Purpose-specific subkeys, derived from TELEMETRY_HASH_KEY with
 * HKDF-SHA256 and an explicit `info` label per purpose — the secret itself
 * never rotates. Each keyed hash below is an HMAC under its own subkey, so
 * a caller hash and an endpoint hash can never be computed with the same
 * key, whatever their inputs.
 *
 *   - Endpoint subkey: one label for the key's whole lifetime, so the same
 *     endpoint always hashes the same (demand is comparable across the
 *     90-day retention window).
 *   - Caller subkey: the label includes the 30-day period, so each period
 *     gets an unrelated key and callers can't be linked across periods.
 */
export const ENDPOINT_KEY_INFO = "agenttrust/telemetry/endpoint-key/v1";
export const CALLER_KEY_INFO_PREFIX = "agenttrust/telemetry/caller-key/v1/period=";

export function deriveTelemetrySubkey(key: string, info: string): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", key, Buffer.alloc(0), info, 32));
}

function hmacHex(subkey: Buffer, message: string): string {
  return crypto.createHmac("sha256", subkey).update(message).digest("hex");
}

/**
 * The hostname of an endpoint URL, only if it's a public DNS name —
 * otherwise null. Rejects IP literals (v4 and v6), localhost, single-label
 * names, non-public suffixes, over-long names and anything that isn't a
 * plain lowercase DNS label sequence.
 */
export function sanitizeEndpointHost(endpointUrl: string): string | null {
  const normalized = normalizeEndpointUrlForLookup(endpointUrl);
  if (!normalized) return null;
  let hostname: string;
  try {
    hostname = new URL(normalized).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (hostname.endsWith(".")) hostname = hostname.slice(0, -1);
  if (!hostname || hostname.length > MAX_HOSTNAME_LENGTH) return null;
  if (hostname.startsWith("[") || isIP(hostname) !== 0) return null;

  const labels = hostname.split(".");
  if (labels.length < 2) return null;
  const labelPattern = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
  if (!labels.every((label) => labelPattern.test(label))) return null;
  // An all-numeric final label is an IP-like form, never a real TLD.
  if (/^[0-9]+$/.test(labels[labels.length - 1])) return null;

  for (const suffix of NON_PUBLIC_SUFFIXES) {
    if (hostname === suffix || hostname.endsWith(`.${suffix}`)) return null;
  }
  return hostname;
}

/**
 * A keyed hash of the endpoint URL with its query string and fragment
 * removed — so the same endpoint counts as one demand signal, and nothing
 * in a query (tokens, ids) is ever part of what's hashed or stored. Under
 * the endpoint subkey, which doesn't depend on time: stable for as long as
 * TELEMETRY_HASH_KEY is unchanged.
 */
export function endpointKey(endpointUrl: string, key: string | null): string | null {
  if (!key) return null;
  const normalized = normalizeEndpointUrlForLookup(endpointUrl);
  if (!normalized) return null;
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return null;
  }
  url.search = "";
  url.hash = "";
  return hmacHex(deriveTelemetrySubkey(key, ENDPOINT_KEY_INFO), url.toString());
}

/** Which CALLER_KEY_PERIOD_DAYS-long period `now` falls in. */
export function callerKeyPeriod(now: Date): number {
  return Math.floor(now.getTime() / (CALLER_KEY_PERIOD_DAYS * DAY_MS));
}

/**
 * A keyed, period-rotating caller identifier — never the IP or a plain hash
 * of it. Under the caller subkey for `now`'s 30-day period: the same IP
 * gives the same value within a period and an unrelated one in the next.
 */
export function callerKey(ip: string | null, key: string | null, now: Date): string | null {
  if (!ip || !key) return null;
  const subkey = deriveTelemetrySubkey(key, `${CALLER_KEY_INFO_PREFIX}${callerKeyPeriod(now)}`);
  return hmacHex(subkey, ip);
}

/**
 * The first product token of a User-Agent header (e.g. "claude-code",
 * "python-httpx", "node"), lowercased — enough to tell AI clients from
 * scripts and browsers without keeping the full header.
 */
export function clientFamily(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const token = userAgent.trim().split(/[\/\s(]/)[0]?.toLowerCase() ?? "";
  if (!token || !/^[a-z0-9][a-z0-9._-]*$/.test(token)) return null;
  return token.slice(0, MAX_CLIENT_FAMILY_LENGTH);
}

export type TrustCheckEventInput = {
  surface: TrustCheckSurface;
  request: Request;
  endpointUrl: string;
} & (
  | {
      outcome: "matched";
      agentId: string;
      recommended: boolean;
      confidence: string;
    }
  | { outcome: "not_matched" }
);

export type TrustCheckEventRow = typeof trustCheckEvents.$inferInsert;

/** The row to store for one check. Pure: no I/O. */
export function buildTrustCheckEvent(
  input: TrustCheckEventInput,
  key: string | null,
  now: Date,
): TrustCheckEventRow {
  const base = {
    occurredAt: now,
    surface: input.surface,
    callerKey: callerKey(extractTrustedClientIp(input.request), key, now),
    clientFamily: clientFamily(input.request.headers.get("user-agent")),
  };
  if (input.outcome === "matched") {
    return {
      ...base,
      outcome: "matched",
      agentId: input.agentId,
      recommended: input.recommended,
      confidence: input.confidence,
    };
  }
  return {
    ...base,
    outcome: "not_matched",
    endpointHost: sanitizeEndpointHost(input.endpointUrl),
    endpointKey: endpointKey(input.endpointUrl, key),
  };
}

export type RecordOutcome = "recorded" | "daily_cap" | "caller_cap";

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Stores one event, subject to the daily and per-caller caps, and
 * occasionally sweeps rows past retention. The caps are soft under
 * concurrency (a few racing inserts can land just past them), which is fine
 * for their purpose — bounding storage and one caller's influence.
 */
export async function recordTrustCheckEvent(
  db: AppDatabase,
  row: TrustCheckEventRow,
  options: { now?: Date; random?: () => number } = {},
): Promise<RecordOutcome> {
  const now = options.now ?? new Date();
  const dayStart = startOfUtcDay(now);

  const [{ total, fromCaller }] = await db
    .select({
      total: count(),
      fromCaller: row.callerKey
        ? sql<number>`count(*) filter (where ${trustCheckEvents.callerKey} = ${row.callerKey})`
        : sql<number>`0`,
    })
    .from(trustCheckEvents)
    .where(gte(trustCheckEvents.occurredAt, dayStart));

  if (Number(total) >= TELEMETRY_DAILY_EVENT_CAP) return "daily_cap";
  if (Number(fromCaller) >= TELEMETRY_PER_CALLER_DAILY_CAP) return "caller_cap";

  await db.insert(trustCheckEvents).values({ ...row, occurredAt: row.occurredAt ?? now });

  if ((options.random ?? Math.random)() < RETENTION_SWEEP_PROBABILITY) {
    await sweepExpiredTrustCheckEvents(db, now);
  }
  return "recorded";
}

/** Deletes up to one batch of events older than TELEMETRY_RETENTION_DAYS. */
export async function sweepExpiredTrustCheckEvents(db: AppDatabase, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - TELEMETRY_RETENTION_DAYS * DAY_MS);
  const expired = db
    .select({ id: trustCheckEvents.id })
    .from(trustCheckEvents)
    .where(lt(trustCheckEvents.occurredAt, cutoff))
    .limit(RETENTION_SWEEP_BATCH);
  const deleted = await db
    .delete(trustCheckEvents)
    .where(and(inArray(trustCheckEvents.id, expired), lt(trustCheckEvents.occurredAt, cutoff)))
    .returning({ id: trustCheckEvents.id });
  return deleted.length;
}

/** Runs `task` once the response has been sent. */
export type TelemetryScheduler = (task: () => Promise<void>) => void;

/**
 * Next's `after()` when there's a request scope (route handlers, server
 * components); otherwise (scripts) the task runs detached. Either way it
 * never delays or throws into the caller.
 */
export const scheduleAfterResponse: TelemetryScheduler = (task) => {
  try {
    after(task);
  } catch {
    void task();
  }
};

/**
 * The one entry point callers use: records a check after the response,
 * swallowing every failure. Never throws, never awaits anything the
 * caller is waiting on, and logs failures without any request detail.
 */
export function trackTrustCheck(
  db: AppDatabase,
  input: TrustCheckEventInput,
  schedule: TelemetryScheduler = scheduleAfterResponse,
): void {
  try {
    const now = new Date();
    schedule(async () => {
      try {
        const row = buildTrustCheckEvent(input, telemetryHashKey(), now);
        await recordTrustCheckEvent(db, row, { now });
      } catch (error) {
        console.error(
          "Trust-check telemetry was not recorded:",
          error instanceof Error ? error.name : "unknown error",
        );
      }
    });
  } catch {
    // A scheduling failure must never reach the trust check.
  }
}
