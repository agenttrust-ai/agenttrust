import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  sdkErrorCodes,
  sdkExportedFunctions,
  sdkMatchedResultFields,
  sdkPolicyOptions,
} from "@/lib/test/sdk-source";
import {
  SDK_EXAMPLE_ENDPOINT,
  SDK_INSTALL,
  SDK_NPM_URL,
  SDK_README_URL,
} from "@/app/docs/sdk-reference";
import {
  AUTHENTICATED_MCP_URL,
  CLAUDE_CODE_ADD_AUTHENTICATED_COMMAND,
  CLAUDE_CODE_ADD_COMMAND,
  CLAUDE_DIRECTORY_URL,
  CURSOR_AUTHENTICATED_CONFIG_JSON,
  CURSOR_CONFIG_JSON,
  OFFICIAL_SETUP_DOCS,
  PUBLIC_MCP_URL,
} from "@/app/docs/mcp-clients";

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

  it("says check_agent_trust over MCP needs no account or API key, at the public connector", () => {
    expect(flat()).toMatch(
      /The MCP tool `check_agent_trust` at \/api\/mcp\/public is anonymous and read-only: no AgentTrust account or API key/,
    );
    // The workflow's no-key lookup step points at the public connector too.
    expect(flat()).toContain(
      "`check_agent_trust({endpointUrl})` over MCP at /api/mcp/public.",
    );
  });

  it("still says REST and every other MCP tool require an API key", () => {
    expect(flat()).toMatch(/Every REST `\/api\/v1\/\*` request, and every other MCP tool, requires an API key/);
    expect(flat()).toContain("Every `/api/v1/*` request requires `Authorization: Bearer <API_KEY>`.");
  });

  it("names the no-auth /api/mcp/public endpoint and describes check_agent_trust like the tool does", () => {
    expect(flat()).toContain(
      "No-auth endpoint with only check_agent_trust and assess_agent: `https://getagenttrust.com/api/mcp/public`",
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

describe("llms.txt SDK section", () => {
  const sdkSection = () =>
    text().match(/## SDK \(TypeScript\)\n([\s\S]*?)\n## /)?.[1] ?? "";

  it("has an SDK section, and no longer says there is no official SDK", () => {
    expect(sdkSection()).not.toBe("");
    expect(flat()).not.toMatch(/no official SDK/i);
  });

  it("gives the install command, the npm package, the full reference and the example endpoint", () => {
    expect(text()).toContain(SDK_INSTALL);
    expect(sdkSection()).toContain(SDK_NPM_URL);
    expect(sdkSection()).toContain(SDK_README_URL);
    expect(sdkSection()).toContain(SDK_EXAMPLE_ENDPOINT);
  });

  it("documents every exported function and class, policy option, result field and error code", () => {
    const section = sdkSection();
    for (const name of [
      ...sdkExportedFunctions(),
      ...sdkPolicyOptions(),
      ...sdkMatchedResultFields(),
      ...sdkErrorCodes(),
    ]) {
      expect(section).toContain(name);
    }
  });

  it("says the boolean policy options must be booleans and invalid policies throw TypeError", () => {
    expect(sdkSection().replace(/\s+/g, " ")).toContain(
      "booleans must be true or false",
    );
    expect(sdkSection()).toContain("TypeError");
  });
});

describe("llms.txt MCP client setup", () => {
  const setup = () =>
    text().match(
      /### Connect an MCP client\n([\s\S]*?)\n### Endpoints and tools/,
    )?.[1] ?? "";
  const indent = (block: string) =>
    block
      .split("\n")
      .map((line) => `  ${line}`)
      .join("\n");

  it("has the setup block, with the public no-key connector first", () => {
    expect(setup()).not.toBe("");
    expect(setup()).toContain("Public connector — no key");
    expect(setup().indexOf(PUBLIC_MCP_URL)).toBeLessThan(
      setup().indexOf(AUTHENTICATED_MCP_URL + "\n"),
    );
  });

  it("shows the same Claude Code commands and Cursor configs as /docs, verbatim", () => {
    expect(setup()).toContain(CLAUDE_CODE_ADD_COMMAND);
    expect(setup()).toContain(indent(CURSOR_CONFIG_JSON));
    expect(setup()).toContain(CLAUDE_CODE_ADD_AUTHENTICATED_COMMAND);
    expect(setup()).toContain(indent(CURSOR_AUTHENTICATED_CONFIG_JSON));
    expect(setup()).toContain(CLAUDE_DIRECTORY_URL);
  });

  it("keeps the keyed setup after the public one, behind a placeholder key", () => {
    const [publicPart, keyedPart] = setup().split("Full MCP server (API key)");
    expect(publicPart).toContain(CLAUDE_CODE_ADD_COMMAND);
    expect(publicPart.split("Claude Code (")[1]).not.toMatch(/--header|Bearer/);
    expect(keyedPart).toContain("<API_KEY>");
  });

  it("links each client's official setup documentation", () => {
    for (const url of Object.values(OFFICIAL_SETUP_DOCS))
      expect(setup()).toContain(url);
  });
});
