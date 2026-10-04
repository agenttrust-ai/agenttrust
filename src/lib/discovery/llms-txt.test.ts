import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * public/llms.txt — the plain-text reference AI agents fetch (served at
 * /llms.txt). File-content tests, like agent-card.test.ts: they pin the
 * authentication facts an agent acts on, so the file can't drift back into
 * telling callers the anonymous trust check needs a key.
 */
const LLMS_PATH = path.resolve(import.meta.dirname, "../../../public/llms.txt");
const text = () => fs.readFileSync(LLMS_PATH, "utf8");
const flat = () => text().replace(/\s+/g, " ");

describe("llms.txt authentication facts", () => {
  it("never says a key is needed on every request, REST or MCP", () => {
    expect(flat()).not.toMatch(/every request,? REST or MCP/i);
  });

  it("says check_agent_trust over MCP needs no account or API key", () => {
    expect(flat()).toMatch(
      /The MCP tool `check_agent_trust` at \/api\/mcp is anonymous and read-only: no AgentTrust account or API key/,
    );
  });

  it("still says REST and every other MCP tool require an API key", () => {
    expect(flat()).toMatch(/Every REST `\/api\/v1\/\*` request, and every other MCP tool, requires an API key/);
    expect(flat()).toContain("Every `/api/v1/*` request requires `Authorization: Bearer <API_KEY>`.");
  });

  it("names the no-auth /api/mcp/public endpoint and describes check_agent_trust like the tool does", () => {
    expect(flat()).toContain(
      "No-auth endpoint with only check_agent_trust: `https://getagenttrust.com/api/mcp/public`",
    );
    // The summary is a "> " blockquote, so a line break there leaves a "> " in the phrase.
    expect(flat()).toMatch(/Before invoking an unknown AI agent (> )?or MCP server, call check_agent_trust/);
    expect(flat()).toContain("pre-invocation trust check for an unknown AI agent or MCP server endpoint");
    expect(flat()).not.toMatch(/the preferred check/i);
  });

  it("contains no real key or secret values", () => {
    // The documented placeholder (`at_live_` followed only by x's) is fine; anything else isn't.
    expect(text()).not.toMatch(/at_live_(?!x+\b)[A-Za-z0-9_-]{20,}/);
    for (const forbidden of ["DATABASE_URL", "DIRECT_URL", "CRON_SECRET", "service_role"]) {
      expect(text()).not.toContain(forbidden);
    }
  });
});
