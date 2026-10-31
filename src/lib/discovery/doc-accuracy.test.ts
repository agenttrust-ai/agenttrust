import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DocsPage from "@/app/docs/page";
import { SDK_ERROR_CODES } from "@/app/docs/sdk-reference";
import {
  ANONYMOUS_LIMIT,
  ANONYMOUS_LIMIT_OVER_TEXT,
  ANONYMOUS_LIMIT_TEXT,
  KEYED_LIMIT,
  KEYED_LIMIT_LABEL,
} from "@/app/docs/rate-limits";

/**
 * Statements in README.md, the SDK README, /docs and /llms.txt that are
 * easy to let drift from the code: the anonymous rate limit, the
 * monitoring cadence, which tools need a key, the SDK version to use, the
 * SDK client's methods and what PROTOCOL_ERROR covers. Each is checked
 * against the source that decides it, not against another copy of the docs.
 */
const ROOT = path.resolve(import.meta.dirname, "../../..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
const noTicks = (s: string) => s.replace(/`/g, "");
/** A numeric `export const NAME = 123;` from a source file. */
const constant = (file: string, name: string) =>
  Number(read(file).match(new RegExp(`export const ${name} = ([0-9_]+);`))?.[1]);

const LLMS = flat(read("public/llms.txt"));
const README = read("README.md");
const SDK_README = read("packages/sdk/README.md");
const DOCS_HTML = renderToStaticMarkup(DocsPage());
const DOCS = flat(
  DOCS_HTML.replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">"),
).replace(/\s+([,.:;)])/g, "$1").replace(/([(])\s+/g, "$1");
const docsSection = (id: string) =>
  flat(
    (DOCS_HTML.match(new RegExp(`<section id="${id}"[\\s\\S]*?</section>`))?.[0] ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&#x27;/g, "'"),
  ).replace(/\s+([,.:;)])/g, "$1").replace(/([(])\s+/g, "$1");

describe("anonymous rate limit", () => {
  const LIMITER = "src/lib/api/anonymous-rate-limit.ts";

  it("documents the numbers the code enforces", () => {
    expect(ANONYMOUS_LIMIT).toEqual({
      perIp: constant(LIMITER, "ANONYMOUS_RATE_LIMIT_PER_IP"),
      global: constant(LIMITER, "ANONYMOUS_RATE_LIMIT_GLOBAL"),
      windowSeconds: constant(LIMITER, "ANONYMOUS_RATE_LIMIT_WINDOW_SECONDS"),
    });
    expect(KEYED_LIMIT).toEqual({
      perKey: constant("src/lib/rate-limit/config.ts", "DEFAULT_RATE_LIMIT_PER_WINDOW"),
      windowSeconds: constant("src/lib/rate-limit/config.ts", "RATE_LIMIT_WINDOW_SECONDS"),
    });
  });

  it("is shared by exactly check_agent_trust and assess_agent, which the browser checker also calls", () => {
    const callers = ["src/lib/mcp/tools.ts", "src/lib/mcp/assess-agent-tool.ts"];
    for (const file of callers)
      expect(read(file)).toContain("await checkAnonymousRateLimit(db, request)");
    expect(read("src/lib/mcp/tools.ts")).toMatch(
      /export async function mcpCheckAgentTrust[\s\S]*?checkAnonymousRateLimit/,
    );
    expect(read("src/lib/mcp/assess-agent-tool.ts")).toMatch(
      /export async function mcpAssessAgent[\s\S]*?checkAnonymousRateLimit/,
    );
    expect(read("src/app/check-agent-trust/page.tsx")).toContain("mcpCheckAgentTrust(");
  });

  it("answers over the limit with a RATE_LIMITED tool error and retryAfterSeconds", () => {
    // Both tools turn the limit into toErrorResult: isError + structuredContent.error.
    for (const file of ["src/lib/mcp/tools.ts", "src/lib/mcp/assess-agent-tool.ts"])
      expect(read(file)).toMatch(/ErrorCode\.RATE_LIMITED[\s\S]*?retryAfterSeconds[\s\S]*?toErrorResult/);
    expect(read("src/lib/mcp/tools.ts")).toMatch(
      /structuredContent: \{ error: enriched \},\s*isError: true/,
    );
  });

  it("is explained on /docs and in llms.txt, before the API-key limit", () => {
    const rateLimits = docsSection("rate-limits");
    for (const text of [ANONYMOUS_LIMIT_TEXT, ANONYMOUS_LIMIT_OVER_TEXT, KEYED_LIMIT_LABEL]) {
      expect(rateLimits).toContain(flat(noTicks(text)));
      expect(LLMS).toContain(flat(text));
    }
    expect(LLMS.indexOf(flat(ANONYMOUS_LIMIT_TEXT))).toBeLessThan(
      LLMS.indexOf(flat(KEYED_LIMIT_LABEL)),
    );
  });

  it("is in the SDK README's RATE_LIMITED row", () => {
    const row = SDK_README.match(/^\| `RATE_LIMITED` \|.*$/m)?.[0] ?? "";
    expect(row).toContain(`${ANONYMOUS_LIMIT.perIp} checks per minute per IP address`);
    expect(row).toContain(`${ANONYMOUS_LIMIT.global} per minute across all anonymous callers`);
    for (const fn of ["checkAgentTrust", "assertTrusted", "assessAgent"]) expect(row).toContain(fn);
  });

  it("no longer says an MCP rate limit is a 429", () => {
    expect(LLMS).not.toMatch(/a 429 carries/);
    expect(DOCS).not.toMatch(/a 429 carries/);
  });
});

describe("which tools need an API key", () => {
  it("never says every other MCP tool needs a key", () => {
    for (const doc of [LLMS, DOCS, flat(README)])
      expect(doc).not.toMatch(/every other MCP tool/i);
  });

  it("names both anonymous tools wherever the docs list what needs no key", () => {
    expect(LLMS).toContain(
      "The MCP tools `check_agent_trust` and `assess_agent` at /api/mcp/public are anonymous and read-only",
    );
    expect(docsSection("workflow")).toContain(
      "The anonymous MCP tools check_agent_trust and assess_agent need no key.",
    );
    const interfaces = README.match(/^\| Interfaces \|.*$/m)?.[0] ?? "";
    expect(interfaces).toContain("`check_agent_trust` and `assess_agent` at `/api/mcp/public`");
  });
});

describe("monitoring cadence", () => {
  it("health checks run once a day, as the docs say", () => {
    const crons = JSON.parse(read("vercel.json")).crons as { path: string; schedule: string }[];
    const healthChecks = crons.filter((c) => c.path.endsWith("/run-health-checks"));
    expect(healthChecks).toHaveLength(1);
    expect(healthChecks[0].schedule).toMatch(/^\d+ \d+ \* \* \*$/);
    expect(README).toContain("health-checked once a day");
    expect(LLMS).toContain("health-checked once a day");
  });

  it("never claims continuous monitoring", () => {
    for (const doc of [LLMS, flat(README), DOCS, flat(SDK_README)])
      expect(doc).not.toMatch(/continuous(ly)? (health-)?monitor/i);
  });
});

describe("SDK version, methods and errors", () => {
  it("recommends 0.2.0 or later, the version published from this source", () => {
    const { version } = JSON.parse(read("packages/sdk/package.json"));
    expect(version).toMatch(/^0\.2\.\d+$/);
    expect(LLMS).toContain("Use version 0.2.0 or later");
    expect(docsSection("sdk")).toContain("Use version 0.2.0 or later");
    for (const doc of [LLMS, DOCS]) expect(doc).not.toMatch(/0\.1\.2 or later/);
  });

  it("says the SDK covers both anonymous tools, not only the trust check", () => {
    for (const doc of [LLMS, DOCS]) {
      expect(doc).toContain("The official SDK covers only the two anonymous checks");
      expect(doc).not.toMatch(/covers only the anonymous trust check/);
      expect(doc).not.toMatch(/SDK for the anonymous trust check/);
    }
  });

  it("lists every method of an AgentTrustClient", () => {
    const iface =
      read("packages/sdk/src/client.ts").match(/export interface AgentTrustClient \{([\s\S]*?)\n\}/)?.[1] ?? "";
    const methods = [...iface.matchAll(/^ {2}(\w+)\(/gm)].map((m) => m[1]);
    expect(methods).toEqual(expect.arrayContaining(["checkAgentTrust", "assertTrusted", "assessAgent"]));
    expect(LLMS).toContain(`same ${methods.join("/")} methods`);
    const options = SDK_README.match(/^`createAgentTrustClient\(options\?\)` returns.*$/m)?.[0] ?? "";
    for (const method of methods) expect(options).toContain(`\`${method}\``);
  });

  it("describes PROTOCOL_ERROR for both tools, as the client raises it", () => {
    const client = read("packages/sdk/src/client.ts");
    for (const tool of ["check_agent_trust", "assess_agent"])
      expect(client).toMatch(new RegExp(`"PROTOCOL_ERROR", "${tool} returned`));
    const docs = SDK_ERROR_CODES.find((e) => e.code === "PROTOCOL_ERROR")?.meaning ?? "";
    const readme = SDK_README.match(/^\| `PROTOCOL_ERROR` \|.*$/m)?.[0] ?? "";
    for (const text of [docs, readme, LLMS]) {
      expect(text).toContain("check_agent_trust");
      expect(text).toContain("assess_agent");
    }
    expect(LLMS).toContain("PROTOCOL_ERROR (not a valid check_agent_trust or assess_agent result)");
  });
});
