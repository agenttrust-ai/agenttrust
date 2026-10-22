import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SDK_CHECK_EXAMPLE,
  SDK_EXAMPLE_ENDPOINT,
  SDK_INSTALL,
  SDK_NPM_URL,
} from "@/app/docs/sdk-reference";
import {
  BROWSER_CHECK_URL,
  CLAUDE_CODE_ADD_COMMAND,
  PUBLIC_MCP_URL,
} from "@/app/docs/quick-start";
import { AUTHENTICATED_MCP_URL } from "@/app/docs/mcp-clients";

/**
 * README.md — the repository's GitHub landing page. File-content tests: its
 * quick start must use the same verified snippets as /docs. Its TypeScript
 * must be the SDK example that packages/sdk/src/readme.test.ts compiles (via
 * the SDK README), so it can't drift into code that doesn't compile.
 */
const ROOT = path.resolve(import.meta.dirname, "../../..");
const README = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
const SDK_README = fs.readFileSync(
  path.join(ROOT, "packages/sdk/README.md"),
  "utf8",
);
const quickStart = () =>
  README.match(/## Quick start — no account needed\n([\s\S]*?)\n## /)?.[1] ??
  "";
const codeBlocks = (lang: string) =>
  [
    ...README.matchAll(new RegExp("```" + lang + "\\n([\\s\\S]*?)\\n```", "g")),
  ].map((match) => match[1]);

describe("README quick start (no account)", () => {
  it("has a quick start before the agent-management section", () => {
    expect(quickStart()).not.toBe("");
    expect(README.indexOf("## Quick start")).toBeLessThan(
      README.indexOf("## Public checks vs. agent management"),
    );
  });

  it("uses AgentTrust's own monitored test agent as the example endpoint", () => {
    expect(quickStart()).toContain(SDK_EXAMPLE_ENDPOINT);
    expect(README).not.toContain("allagents.app");
  });

  it("gives the public MCP connector and the verified Claude Code command", () => {
    expect(quickStart()).toContain(PUBLIC_MCP_URL);
    expect(codeBlocks("bash")).toContain(CLAUDE_CODE_ADD_COMMAND);
    expect(quickStart()).toContain(
      "https://getagenttrust.com/docs#mcp-clients",
    );
  });

  it("gives the SDK install command and only the compile-tested SDK example", () => {
    expect(codeBlocks("bash")).toContain(SDK_INSTALL);
    const tsBlocks = codeBlocks("ts");
    expect(tsBlocks.length).toBeGreaterThan(0);
    for (const block of tsBlocks) expect(block).toBe(SDK_CHECK_EXAMPLE);
    // The same example is compiled by packages/sdk/src/readme.test.ts.
    expect(SDK_README).toContain(SDK_CHECK_EXAMPLE);
  });

  it("links the browser checker, the SDK README and npm", () => {
    expect(README).toContain(`https://getagenttrust.com${BROWSER_CHECK_URL}`);
    expect(README).toContain("](packages/sdk/README.md)");
    expect(fs.existsSync(path.join(ROOT, "packages/sdk/README.md"))).toBe(true);
    expect(README).toContain(SDK_NPM_URL);
  });

  it("no longer shows bare check_agent_trust({ … }) pseudo-calls", () => {
    expect(README).not.toMatch(/check_agent_trust\(\{/);
  });
});

describe("README public checks vs. agent management", () => {
  const section = () =>
    README.match(
      /## Public checks vs\. agent management\n([\s\S]*?)\n## /,
    )?.[1] ?? "";

  it("separates the no-key public check from the keyed agent management", () => {
    const [header, , ...rows] = section()
      .split("\n")
      .filter((line) => line.startsWith("|"));
    expect(header).toMatch(/Public trust checks.*Agent management/);
    const row = (label: string) => rows.find((r) => r.includes(label)) ?? "";
    expect(row("Account / API key")).toMatch(
      /Not needed.*Authorization: Bearer <API_KEY>/,
    );
    expect(row("Interfaces")).toContain("/api/mcp/public");
    expect(row("Interfaces")).toContain(
      new URL(AUTHENTICATED_MCP_URL).pathname + "`",
    );
  });
});

describe("README documentation links and secrets", () => {
  it("links the full documentation and llms.txt", () => {
    expect(README).toContain("(https://getagenttrust.com/docs)");
    expect(README).toContain("(https://getagenttrust.com/llms.txt)");
  });

  it("contains no real key or secret values", () => {
    expect(README).not.toMatch(
      /at_live_(?!x+\b)[A-Za-z0-9_-]{20,}|Bearer (?!<API_KEY>)[A-Za-z0-9._-]{16,}/,
    );
  });
});
