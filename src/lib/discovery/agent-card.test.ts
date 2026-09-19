import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * AgentTrust's own A2A Agent Card — a static file at the spec-required
 * well-known path (public/.well-known/agent-card.json -> served at
 * /.well-known/agent-card.json), describing AgentTrust itself as a trust
 * service to another A2A-capable agent. Not to be confused with
 * src/lib/validation/agent-card.ts, which builds a much smaller card *for
 * each monitored agent* — this file is the one AgentTrust publishes about
 * itself.
 *
 * These are file-content tests, not HTTP tests — this project has no
 * precedent for spinning up a live Next.js server in a test (every
 * existing test runs against pglite or pure functions), and a static
 * file's actual HTTP reachability is exactly what the mandated production
 * smoke test verifies instead.
 */
const CARD_PATH = path.resolve(
  import.meta.dirname,
  "../../../public/.well-known/agent-card.json",
);

function readCard(): Record<string, unknown> {
  const raw = fs.readFileSync(CARD_PATH, "utf8");
  return JSON.parse(raw);
}

describe("AgentTrust's A2A Agent Card (public/.well-known/agent-card.json)", () => {
  it("exists and is valid JSON", () => {
    expect(fs.existsSync(CARD_PATH)).toBe(true);
    expect(() => readCard()).not.toThrow();
  });

  it("has every A2A-spec-required field, correctly typed", () => {
    const card = readCard();
    // Required per the current A2A specification (protocolVersion, name, url).
    expect(typeof card.protocolVersion).toBe("string");
    expect(card.protocolVersion).toBe("1.0"); // Major.Minor only — patch numbers SHOULD NOT appear here per spec.
    expect(typeof card.name).toBe("string");
    expect(card.name).toBe("AgentTrust");
    expect(typeof card.url).toBe("string");
    expect(() => new URL(card.url as string)).not.toThrow();
    expect((card.url as string).startsWith("https://")).toBe(true);
  });

  it("declares only capabilities that exist in production today", () => {
    const card = readCard();
    const capabilities = card.capabilities as Record<string, unknown>;
    // No streaming (SSE) and no push-notification transport exist in the
    // real REST API — the card must not claim otherwise.
    expect(capabilities.streaming).toBe(false);
    expect(capabilities.pushNotifications).toBe(false);
  });

  it("never claims marketplace, payment, or auto-invocation capabilities", () => {
    const raw = fs.readFileSync(CARD_PATH, "utf8").toLowerCase();
    for (const forbidden of ["marketplace", "payment", "invoke automatically", "auto-invoke", "billing"]) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it("makes the trust-check and reliability capability machine-identifiable via skills", () => {
    const card = readCard();
    const skills = card.skills as { id: string; tags: string[]; description: string }[];
    expect(Array.isArray(skills)).toBe(true);
    expect(skills.length).toBeGreaterThan(0);

    const allTags = skills.flatMap((s) => s.tags ?? []);
    expect(allTags).toContain("trust-check");
    expect(allTags).toContain("reliability");
    expect(allTags).toContain("trust-decision");
    expect(allTags).toContain("ownership-verification");

    const allText = skills.map((s) => s.description).join(" ").toLowerCase();
    expect(allText).toMatch(/trustdecision|trust decision/);
    expect(allText).toMatch(/reliability/);
    expect(allText).toMatch(/ownership/);
    expect(allText).toMatch(/endpoint/);
  });

  it("describes discovery by endpoint URL, matching the real ?endpoint_url= lookup", () => {
    const card = readCard();
    const skills = card.skills as { description: string; examples?: string[] }[];
    const allText = skills.map((s) => `${s.description} ${(s.examples ?? []).join(" ")}`).join(" ");
    expect(allText.toLowerCase()).toMatch(/url/);
  });

  it("references the real, existing documentation and API base — no fabricated URLs", () => {
    const card = readCard();
    expect(card.documentationUrl).toBe("https://getagenttrust.com/docs");
    expect(card.url).toBe("https://getagenttrust.com/api/v1");
  });

  it("describes the real Bearer auth scheme without embedding any actual credential", () => {
    const card = readCard();
    const schemes = card.securitySchemes as Record<string, { type: string; scheme?: string }>;
    expect(schemes.bearerAuth.type).toBe("http");
    expect(schemes.bearerAuth.scheme).toBe("bearer");
  });

  it("contains no secrets, credentials, tokens, or environment values", () => {
    const raw = fs.readFileSync(CARD_PATH, "utf8");
    expect(raw).not.toMatch(/at_live_[A-Za-z0-9_-]+/); // a real API key shape
    for (const forbidden of [
      "DATABASE_URL",
      "DIRECT_URL",
      "CRON_SECRET",
      "AGENT_CREDENTIAL_ENCRYPTION_KEY",
      "API_KEY_HASH_PEPPER",
      "SUPABASE_SECRET",
      "service_role",
    ]) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it("carries no private per-agent data — describes AgentTrust itself, not any monitored agent", () => {
    const card = readCard();
    for (const forbidden of ["ownerId", "ownershipVerificationToken", "authCredential", "endpointUrl"]) {
      expect(JSON.stringify(card)).not.toContain(forbidden);
    }
  });
});
