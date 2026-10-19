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
