import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb } from "@/lib/db/test-harness";
import type { AppDatabase } from "@/lib/db/rls";
import { withAnonContext } from "@/lib/db/rls";
import { trustCheckEvents } from "@/lib/db/schema";
import {
  CALLER_KEY_INFO_PREFIX,
  CALLER_KEY_PERIOD_DAYS,
  ENDPOINT_KEY_INFO,
  TELEMETRY_DAILY_EVENT_CAP,
  TELEMETRY_PER_CALLER_DAILY_CAP,
  TELEMETRY_RETENTION_DAYS,
  buildTrustCheckEvent,
  callerKey,
  callerKeyPeriod,
  clientFamily,
  deriveTelemetrySubkey,
  endpointKey,
  recordTrustCheckEvent,
  sanitizeEndpointHost,
  sweepExpiredTrustCheckEvents,
  telemetryHashKey,
  trackTrustCheck,
} from "./trust-check-events";

const KEY = "k".repeat(48);
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-30T12:00:00.000Z");

function requestWith(headers: Record<string, string>): Request {
  return new Request("https://mcp.internal/check-agent-trust", { headers });
}

describe("telemetryHashKey — optional, never able to break startup", () => {
  const original = process.env.TELEMETRY_HASH_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.TELEMETRY_HASH_KEY;
    else process.env.TELEMETRY_HASH_KEY = original;
  });

  it("is null when unset, and when too short to be a real key", () => {
    delete process.env.TELEMETRY_HASH_KEY;
    expect(telemetryHashKey()).toBeNull();
    process.env.TELEMETRY_HASH_KEY = "short";
    expect(telemetryHashKey()).toBeNull();
  });

  it("is the key when it's at least 32 characters", () => {
    process.env.TELEMETRY_HASH_KEY = KEY;
    expect(telemetryHashKey()).toBe(KEY);
  });
});

describe("sanitizeEndpointHost — public DNS names only", () => {
  it("keeps a public hostname, lowercased, with no path, query or fragment", () => {
    expect(sanitizeEndpointHost("https://API.Example-Agent.com/v1/invoke?token=abc#frag")).toBe(
      "api.example-agent.com",
    );
  });

  it.each([
    ["an IPv4 literal", "https://203.0.113.10/agent"],
    ["an IPv6 literal", "https://[2001:db8::1]/agent"],
    ["loopback IPv6", "https://[::1]/agent"],
    ["localhost", "https://localhost/agent"],
    ["a localhost subdomain", "https://api.localhost/agent"],
    ["a single-label name", "https://intranet/agent"],
    [".local", "https://printer.local/agent"],
    [".internal", "https://svc.cluster.internal/agent"],
    [".home.arpa", "https://nas.home.arpa/agent"],
    [".corp", "https://agent.acme.corp/agent"],
    [".test", "https://agent.test/agent"],
    [".example", "https://agent.example/agent"],
    [".invalid", "https://agent.invalid/agent"],
    ["an unparseable URL", "not a url"],
  ])("rejects %s", (_label, url) => {
    expect(sanitizeEndpointHost(url)).toBeNull();
  });
});

describe("endpointKey — keyed hash of the URL without query or fragment", () => {
  it("is the same for URLs differing only in query or fragment, and never contains URL material", () => {
    const a = endpointKey("https://agent.acme.io/v1/invoke?token=secret1", KEY);
    const b = endpointKey("https://agent.acme.io/v1/invoke#section", KEY);
    const c = endpointKey("https://agent.acme.io/v1/invoke", KEY);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(a).not.toContain("secret1");
  });

  it("differs by path, follows URL normalization, and needs the key", () => {
    expect(endpointKey("https://agent.acme.io/v1/invoke", KEY)).not.toBe(
      endpointKey("https://agent.acme.io/v2/invoke", KEY),
    );
    expect(endpointKey("HTTPS://Agent.Acme.io/v1/invoke/", KEY)).toBe(
      endpointKey("https://agent.acme.io/v1/invoke", KEY),
    );
    expect(endpointKey("https://agent.acme.io/v1/invoke", null)).toBeNull();
  });
});

describe("callerKey — keyed, rotating, never the IP or a plain hash of it", () => {
  const ip = "198.51.100.23";

  it("is stable within a period and changes at the next period", () => {
    const periodStart = new Date(callerKeyPeriod(NOW) * CALLER_KEY_PERIOD_DAYS * DAY);
    const sameStart = callerKey(ip, KEY, periodStart);
    const lastMs = new Date(periodStart.getTime() + CALLER_KEY_PERIOD_DAYS * DAY - 1);
    const nextPeriod = new Date(periodStart.getTime() + CALLER_KEY_PERIOD_DAYS * DAY);
    expect(callerKey(ip, KEY, lastMs)).toBe(sameStart);
    expect(callerKey(ip, KEY, nextPeriod)).not.toBe(sameStart);
  });

  it("isn't the raw IP, isn't the rate limiter's unsalted SHA-256, and depends on the key", () => {
    const key = callerKey(ip, KEY, NOW)!;
    expect(key).not.toContain(ip);
    expect(key).not.toBe(crypto.createHash("sha256").update(ip).digest("hex"));
    expect(callerKey(ip, "z".repeat(48), NOW)).not.toBe(key);
  });

  it("is null without a key or an IP", () => {
    expect(callerKey(ip, null, NOW)).toBeNull();
    expect(callerKey(null, KEY, NOW)).toBeNull();
  });
});

describe("keyed-hash derivation — the secret never rotates; each purpose has its own subkey", () => {
  const ip = "198.51.100.23";
  const url = "https://agent.acme.io/v1/invoke";
  const hkdf = (info: string) => Buffer.from(crypto.hkdfSync("sha256", KEY, Buffer.alloc(0), info, 32));
  const hmac = (subkey: Buffer, message: string) =>
    crypto.createHmac("sha256", subkey).update(message).digest("hex");

  it("endpoint_key is HMAC under the endpoint subkey of the URL without query/fragment — no time input", () => {
    expect(endpointKey(`${url}?token=x#f`, KEY)).toBe(hmac(hkdf(ENDPOINT_KEY_INFO), url));
  });

  it("caller_key is HMAC under the caller subkey for the current 30-day period", () => {
    expect(callerKey(ip, KEY, NOW)).toBe(hmac(hkdf(`${CALLER_KEY_INFO_PREFIX}${callerKeyPeriod(NOW)}`), ip));
  });

  it("caller and endpoint subkeys never coincide, and neither hash can stand in for the other", () => {
    const endpointSubkey = deriveTelemetrySubkey(KEY, ENDPOINT_KEY_INFO);
    for (const period of [callerKeyPeriod(NOW), callerKeyPeriod(NOW) + 1]) {
      const callerSubkey = deriveTelemetrySubkey(KEY, `${CALLER_KEY_INFO_PREFIX}${period}`);
      expect(callerSubkey.equals(endpointSubkey)).toBe(false);
    }
    // Same message under the other purpose's subkey gives a different hash.
    expect(callerKey(ip, KEY, NOW)).not.toBe(hmac(endpointSubkey, ip));
    const callerSubkeyNow = deriveTelemetrySubkey(KEY, `${CALLER_KEY_INFO_PREFIX}${callerKeyPeriod(NOW)}`);
    expect(endpointKey(url, KEY)).not.toBe(hmac(callerSubkeyNow, url));
  });

  it("the same unmatched endpoint keeps its endpoint_key across caller periods while caller_key rotates", () => {
    const nextPeriod = new Date(NOW.getTime() + CALLER_KEY_PERIOD_DAYS * DAY);
    const request = requestWith({ "x-vercel-forwarded-for": ip });
    const input = { surface: "mcp" as const, request, endpointUrl: `${url}?q=1`, outcome: "not_matched" as const };
    const now = buildTrustCheckEvent(input, KEY, NOW);
    const later = buildTrustCheckEvent(input, KEY, nextPeriod);
    expect(later.endpointKey).toBe(now.endpointKey);
    expect(later.callerKey).not.toBe(now.callerKey);
    // Still stable after many periods — for the whole 90-day retention window and beyond.
    const muchLater = buildTrustCheckEvent(input, KEY, new Date(NOW.getTime() + 4 * CALLER_KEY_PERIOD_DAYS * DAY));
    expect(muchLater.endpointKey).toBe(now.endpointKey);
  });

  it("a different TELEMETRY_HASH_KEY gives unrelated endpoint and caller hashes", () => {
    const other = "o".repeat(48);
    expect(endpointKey(url, other)).not.toBe(endpointKey(url, KEY));
    expect(callerKey(ip, other, NOW)).not.toBe(callerKey(ip, KEY, NOW));
  });
});

describe("clientFamily — the user-agent's product token only", () => {
  it.each([
    ["claude-code/1.2.3 (darwin; arm64)", "claude-code"],
    ["python-httpx/0.27.0", "python-httpx"],
    ["node", "node"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)", "mozilla"],
  ])("%s -> %s", (ua, expected) => {
    expect(clientFamily(ua)).toBe(expected);
  });

  it("drops empty or unusual values and caps the length", () => {
    expect(clientFamily(null)).toBeNull();
    expect(clientFamily("")).toBeNull();
    expect(clientFamily("<script>/1")).toBeNull();
    expect(clientFamily(`${"a".repeat(100)}/1.0`)).toHaveLength(64);
  });
});

describe("buildTrustCheckEvent — what a stored row contains", () => {
  const request = requestWith({
    "x-vercel-forwarded-for": "198.51.100.23",
    "user-agent": "claude-code/1.2.3",
    authorization: "Bearer at_live_should_never_be_stored",
  });

  it("matched: the agent and its decision, no endpoint data", () => {
    const row = buildTrustCheckEvent(
      {
        surface: "mcp",
        request,
        endpointUrl: "https://agent.acme.io/v1/invoke?token=abc",
        outcome: "matched",
        agentId: "11111111-1111-1111-1111-111111111111",
        recommended: true,
        confidence: "high",
      },
      KEY,
      NOW,
    );
    expect(row).toMatchObject({
      surface: "mcp",
      outcome: "matched",
      agentId: "11111111-1111-1111-1111-111111111111",
      recommended: true,
      confidence: "high",
      clientFamily: "claude-code",
    });
    expect(row).not.toHaveProperty("endpointHost");
    expect(row).not.toHaveProperty("endpointKey");
  });

  it("unmatched: sanitized host and keyed hash only — no URL, query, IP or header material", () => {
    const row = buildTrustCheckEvent(
      {
        surface: "web",
        request,
        endpointUrl: "https://unknown-agent.io/private/path?token=abc#frag",
        outcome: "not_matched",
      },
      KEY,
      NOW,
    );
    expect(row.endpointHost).toBe("unknown-agent.io");
    expect(row.endpointKey).toMatch(/^[0-9a-f]{64}$/);
    expect(row.callerKey).toMatch(/^[0-9a-f]{64}$/);
    const serialized = JSON.stringify(row);
    for (const forbidden of ["/private/path", "token=abc", "#frag", "198.51.100.23", "at_live_", "Bearer"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("without TELEMETRY_HASH_KEY: still a usable row, with no keyed hashes", () => {
    const row = buildTrustCheckEvent(
      { surface: "mcp", request, endpointUrl: "https://unknown-agent.io/a", outcome: "not_matched" },
      null,
      NOW,
    );
    expect(row).toMatchObject({ outcome: "not_matched", endpointHost: "unknown-agent.io" });
    expect(row.endpointKey).toBeNull();
    expect(row.callerKey).toBeNull();
  });
});

describe("recordTrustCheckEvent — caps, retention and access (pglite)", () => {
  let client: PGlite;
  let db: AppDatabase;

  beforeEach(async () => {
    const harness = await createTestDb();
    client = harness.client;
    db = harness.db;
  });
  afterEach(async () => {
    await client.close();
  });

  const unmatched = (callerKeyValue: string | null) => ({
    occurredAt: NOW,
    surface: "mcp" as const,
    outcome: "not_matched" as const,
    endpointHost: "unknown-agent.io",
    endpointKey: "e".repeat(64),
    callerKey: callerKeyValue,
    clientFamily: "node",
  });

  async function seed(n: number, occurredAt: Date, callerKeyValue: string | null) {
    await client.query(
      `insert into public.trust_check_events (occurred_at, surface, outcome, caller_key)
         select $1, 'mcp', 'not_matched', $2 from generate_series(1, $3)`,
      [occurredAt, callerKeyValue, n],
    );
  }

  const rowCount = async () =>
    (await client.query<{ n: number }>(`select count(*)::int as n from public.trust_check_events`)).rows[0].n;

  it("records an event", async () => {
    expect(await recordTrustCheckEvent(db, unmatched("c".repeat(64)), { now: NOW, random: () => 1 })).toBe(
      "recorded",
    );
    expect(await rowCount()).toBe(1);
  });

  it("stops at the daily cap across all callers", async () => {
    await seed(TELEMETRY_DAILY_EVENT_CAP, NOW, null);
    expect(await recordTrustCheckEvent(db, unmatched("c".repeat(64)), { now: NOW, random: () => 1 })).toBe(
      "daily_cap",
    );
    expect(await rowCount()).toBe(TELEMETRY_DAILY_EVENT_CAP);
  });

  it("stops one caller at its daily cap without affecting others", async () => {
    const heavy = "a".repeat(64);
    await seed(TELEMETRY_PER_CALLER_DAILY_CAP, NOW, heavy);
    expect(await recordTrustCheckEvent(db, unmatched(heavy), { now: NOW, random: () => 1 })).toBe(
      "caller_cap",
    );
    expect(await recordTrustCheckEvent(db, unmatched("b".repeat(64)), { now: NOW, random: () => 1 })).toBe(
      "recorded",
    );
  });

  it("counts caps per UTC day — yesterday's events don't count against today", async () => {
    await seed(TELEMETRY_DAILY_EVENT_CAP, new Date(NOW.getTime() - DAY), null);
    expect(await recordTrustCheckEvent(db, unmatched(null), { now: NOW, random: () => 1 })).toBe("recorded");
  });

  it("deletes events past retention and keeps recent ones", async () => {
    await seed(3, new Date(NOW.getTime() - (TELEMETRY_RETENTION_DAYS + 1) * DAY), null);
    await seed(2, new Date(NOW.getTime() - (TELEMETRY_RETENTION_DAYS - 1) * DAY), null);
    expect(await sweepExpiredTrustCheckEvents(db, NOW)).toBe(3);
    expect(await rowCount()).toBe(2);
  });

  it("sweeps retention occasionally as part of recording", async () => {
    await seed(2, new Date(NOW.getTime() - (TELEMETRY_RETENTION_DAYS + 5) * DAY), null);
    await recordTrustCheckEvent(db, unmatched(null), { now: NOW, random: () => 0 });
    expect(await rowCount()).toBe(1);
  });

  it("is invisible to the anonymous database role (RLS on, no policies)", async () => {
    await seed(1, NOW, null);
    const visible = await withAnonContext(db, (tx) => tx.select().from(trustCheckEvents));
    expect(visible).toHaveLength(0);
  });

  it("rejects values outside the allowed surfaces and outcomes", async () => {
    await expect(
      client.query(`insert into public.trust_check_events (surface, outcome) values ('rest', 'matched')`),
    ).rejects.toThrow();
    await expect(
      client.query(`insert into public.trust_check_events (surface, outcome) values ('mcp', 'rate_limited')`),
    ).rejects.toThrow();
  });
});

describe("trackTrustCheck — best-effort, never throws, never contacts anything", () => {
  const input = {
    surface: "mcp" as const,
    request: requestWith({ "x-vercel-forwarded-for": "198.51.100.23" }),
    endpointUrl: "https://unknown-agent.io/secret-path?token=abc",
    outcome: "not_matched" as const,
  };

  it("does not throw when scheduling itself fails", () => {
    const failingDb = {} as AppDatabase;
    expect(() =>
      trackTrustCheck(failingDb, input, () => {
        throw new Error("no request scope");
      }),
    ).not.toThrow();
  });

  it("swallows a recording failure and logs no request detail", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const brokenDb = {
      select: () => {
        throw new Error(`boom ${input.endpointUrl}`);
      },
    } as unknown as AppDatabase;
    let task: (() => Promise<void>) | undefined;
    trackTrustCheck(brokenDb, input, (t) => {
      task = t;
    });
    await expect(task!()).resolves.toBeUndefined();
    const logged = JSON.stringify(errors.mock.calls);
    expect(logged).not.toContain("unknown-agent.io");
    expect(logged).not.toContain("198.51.100.23");
    errors.mockRestore();
  });

  it("makes no network request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const brokenDb = {
      select: () => {
        throw new Error("no db");
      },
    } as unknown as AppDatabase;
    let task: (() => Promise<void>) | undefined;
    trackTrustCheck(brokenDb, input, (t) => {
      task = t;
    });
    await task!();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
