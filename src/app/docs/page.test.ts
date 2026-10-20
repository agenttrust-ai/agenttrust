import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  sdkErrorCodes,
  sdkExportedFunctions,
  sdkMatchedResultFields,
  sdkPolicyOptions,
} from "@/lib/test/sdk-source";
import DocsPage from "./page";
import {
  SDK_ASSERT_EXAMPLE,
  SDK_CHECK_EXAMPLE,
  SDK_ERROR_CODES,
  SDK_EXAMPLE_ENDPOINT,
  SDK_INSTALL,
  SDK_NPM_URL,
  SDK_POLICY_OPTIONS,
  SDK_README_URL,
} from "./sdk-reference";
import {
  BROWSER_CHECK_URL,
  CLAUDE_CODE_ADD_COMMAND,
  MCP_CURL_EXAMPLE,
  MCP_CURL_REQUEST,
  PUBLIC_MCP_URL,
} from "./quick-start";

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ");

const README = fs.readFileSync(
  path.resolve(import.meta.dirname, "../../../packages/sdk/README.md"),
  "utf8",
);

describe("/docs SDK section", () => {
  const html = renderToStaticMarkup(DocsPage());
  const body = text(html);
  const section = text(
    html.match(/<section id="sdk"[\s\S]*?<\/section>/)?.[0] ?? "",
  );

  it("has an SDK section, linked from the page navigation", () => {
    expect(section).toContain("SDK (TypeScript)");
    expect(html).toContain('href="#sdk"');
  });

  it("no longer says there is no official SDK", () => {
    expect(body).not.toMatch(/no official SDK/i);
  });

  it("shows the install command, the npm package and the full reference", () => {
    expect(section).toContain(SDK_INSTALL);
    expect(html).toContain(`href="${SDK_NPM_URL}"`);
    expect(html).toContain(`href="${SDK_README_URL}"`);
  });

  it("uses AgentTrust's own monitored test agent as the example endpoint", () => {
    expect(section).toContain(SDK_EXAMPLE_ENDPOINT);
  });

  it("mentions every function and class the SDK exports", () => {
    for (const name of sdkExportedFunctions()) expect(section).toContain(name);
  });

  it("lists exactly the SDK's policy options and error codes", () => {
    expect(SDK_POLICY_OPTIONS.map((option) => option.name)).toEqual(
      sdkPolicyOptions(),
    );
    expect(SDK_ERROR_CODES.map((error) => error.code)).toEqual(sdkErrorCodes());
    for (const name of sdkPolicyOptions()) expect(section).toContain(name);
    for (const code of sdkErrorCodes()) expect(section).toContain(code);
  });

  it("describes every field of a matched result", () => {
    for (const field of sdkMatchedResultFields())
      expect(section).toContain(field);
  });

  it("shows code examples that also appear verbatim in the SDK README (where they're compiled)", () => {
    for (const example of [SDK_CHECK_EXAMPLE, SDK_ASSERT_EXAMPLE]) {
      expect(README).toContain(example);
      expect(text(html)).toContain(text(example));
    }
  });
});

describe("/docs Quick Start (no-account trust checks first)", () => {
  const html = renderToStaticMarkup(DocsPage());
  const raw =
    html.match(/<section id="quick-start"[\s\S]*?<\/section>/)?.[0] ?? "";
  const section = text(raw);

  it("is the first section on the page", () => {
    expect(raw).not.toBe("");
    expect(html.indexOf('<section id="quick-start"')).toBe(
      html.indexOf("<section id="),
    );
  });

  it("leads with the public MCP connector, before the SDK, the browser and sign-up", () => {
    const at = (needle: string) => section.indexOf(needle);
    expect(at(PUBLIC_MCP_URL)).toBeGreaterThan(-1);
    expect(at(PUBLIC_MCP_URL)).toBeLessThan(at(SDK_INSTALL));
    expect(at(SDK_INSTALL)).toBeLessThan(at("Check the test agent"));
    expect(at("Check the test agent")).toBeLessThan(at("Sign up"));
  });

  it("gives Claude Code's documented `claude mcp add --transport http <name> <url>` command for the public connector", () => {
    expect(CLAUDE_CODE_ADD_COMMAND).toMatch(
      /^claude mcp add --transport http [a-z][a-z0-9-]* https:\/\/\S+$/,
    );
    expect(CLAUDE_CODE_ADD_COMMAND.endsWith(` ${PUBLIC_MCP_URL}`)).toBe(true);
    expect(section).toContain(CLAUDE_CODE_ADD_COMMAND);
    expect(section).toContain("claude mcp list");
  });

  it("shows a curl example that is exactly MCP_CURL_REQUEST (which the route contract test sends)", () => {
    expect(section).toContain(text(MCP_CURL_EXAMPLE));
    const lines = MCP_CURL_EXAMPLE.split("\n");
    expect(lines[0]).toBe(`curl -s ${PUBLIC_MCP_URL} \\`);
    const headers = Object.fromEntries(
      lines.flatMap((line) =>
        [...line.matchAll(/-H "([^:]+): ([^"]+)"/g)].map((m) => [m[1], m[2]]),
      ),
    );
    expect(headers).toEqual(MCP_CURL_REQUEST.headers);
    const body = JSON.parse(
      MCP_CURL_EXAMPLE.match(/-d '([^']+)'/)?.[1] ?? "null",
    );
    expect(body).toEqual(MCP_CURL_REQUEST.body);
    expect(body).toMatchObject({
      method: "tools/call",
      params: {
        name: "check_agent_trust",
        arguments: { endpointUrl: SDK_EXAMPLE_ENDPOINT },
      },
    });
  });

  it("shows the SDK install command and the compile-tested README example", () => {
    expect(section).toContain(SDK_INSTALL);
    expect(README).toContain(SDK_CHECK_EXAMPLE);
    expect(section).toContain(text(SDK_CHECK_EXAMPLE));
  });

  it("links the browser checker, prefilled with the example endpoint", () => {
    expect(raw).toContain(`href="${BROWSER_CHECK_URL.replace(/&/g, "&amp;")}"`);
    expect(
      new URL(BROWSER_CHECK_URL, "https://getagenttrust.com").searchParams.get(
        "endpointUrl",
      ),
    ).toBe(SDK_EXAMPLE_ENDPOINT);
  });

  it("keeps the registration and REST path, below the no-account options", () => {
    expect(raw).toContain('href="/signup"');
    expect(raw).toContain('href="#getting-started"');
    expect(section).toMatch(
      /Registering your own agent, or using the REST API\?/,
    );
  });

  it("lists the public connector first in the page summary", () => {
    const summary = text(html.match(/<dl[\s\S]*?<\/dl>/)?.[0] ?? "");
    expect(summary.indexOf(PUBLIC_MCP_URL)).toBeGreaterThan(-1);
    expect(summary.indexOf(PUBLIC_MCP_URL)).toBeLessThan(
      summary.indexOf("https://getagenttrust.com/api/mcp "),
    );
  });
});
