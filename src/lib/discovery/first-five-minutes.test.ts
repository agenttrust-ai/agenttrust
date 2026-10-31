import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  sdkAssessmentConfidences,
  sdkAssessmentDecisions,
  sdkAssessmentFields,
  sdkErrorCodes,
  sdkExportedFunctions,
} from "@/lib/test/sdk-source";
import { assessAgent, REASON_CODES } from "@/lib/assessment/assess";
import DocsPage from "@/app/docs/page";
import {
  SDK_CALL_GUIDE,
  SDK_CALL_GUIDE_NOTE,
  SDK_DECISION_GUIDE,
  SDK_EXAMPLE_ENDPOINT,
  SDK_EXAMPLE_URL,
  SDK_FIRST_STEPS_EXAMPLE,
  SDK_INSTALL_FIRST_STEPS,
  SDK_POLICY_OPTIONS,
  SDK_UNKNOWN_ENDPOINT,
} from "@/app/docs/sdk-reference";

/**
 * "First 5 minutes" — the onboarding walkthrough in README.md, the SDK
 * README, /docs and /llms.txt. Its text lives once in
 * src/app/docs/sdk-reference.ts; these tests check that all four carry it
 * and that every fact it states matches the SDK and the assessment code.
 * The example itself is compiled by packages/sdk/src/readme.test.ts.
 */
const ROOT = path.resolve(import.meta.dirname, "../../..");
const read = (file: string) =>
  fs.readFileSync(path.join(ROOT, file), "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ").trim();
const noTicks = (s: string) => s.replace(/`/g, "");

const GETTING_STARTED_URL = "https://getagenttrust.com/docs#getting-started";

/** Every sentence of the walkthrough's guides, with its backticks. */
const GUIDE_TEXT = [
  ...SDK_DECISION_GUIDE.flatMap((row) => [row.meaning, row.action]),
  ...SDK_CALL_GUIDE.flatMap((row) => [row.when, row.returns]),
  SDK_CALL_GUIDE_NOTE,
  SDK_UNKNOWN_ENDPOINT.intro,
  ...SDK_UNKNOWN_ENDPOINT.results,
  SDK_UNKNOWN_ENDPOINT.errors,
  SDK_UNKNOWN_ENDPOINT.handling,
];

describe("First 5 minutes — facts match the SDK and the assessment code", () => {
  it("installs a range the current SDK version satisfies", () => {
    expect(SDK_INSTALL_FIRST_STEPS).toBe(
      "npm install @getagenttrust/sdk@^0.2.0",
    );
    const { version } = JSON.parse(read("packages/sdk/package.json"));
    expect(version).toMatch(/^0\.2\.\d+$/);
  });

  it("checks the monitored test agent", () => {
    expect(SDK_FIRST_STEPS_EXAMPLE).toContain(`"${SDK_EXAMPLE_ENDPOINT}"`);
  });

  it("explains exactly the SDK's assessAgent decisions", () => {
    expect(SDK_DECISION_GUIDE.map((row) => row.decision)).toEqual(
      sdkAssessmentDecisions(),
    );
  });

  it("names only real SDK functions, fields, confidences and error codes", () => {
    for (const row of SDK_CALL_GUIDE)
      expect(sdkExportedFunctions()).toContain(row.call.split("(")[0]);
    for (const field of ["matched", "decision", "confidence", "reasonCodes", "limitations"])
      expect(sdkAssessmentFields()).toContain(field);
    expect(sdkAssessmentConfidences()).toContain("none");
    for (const code of ["RATE_LIMITED", "TIMEOUT", "NETWORK_ERROR"])
      expect(sdkErrorCodes()).toContain(code);
    expect(SDK_POLICY_OPTIONS.find((o) => o.name === "allowUnknown"))
      .toMatchObject({ defaultValue: "false" });
  });

  it("quotes only reason codes the assessment can return", () => {
    const quoted = [
      SDK_FIRST_STEPS_EXAMPLE,
      ...SDK_UNKNOWN_ENDPOINT.results,
    ].flatMap((text) => [...text.matchAll(/"([A-Z][A-Z_]{3,})"/g)].map((m) => m[1]));
    expect(quoted).toContain("UNKNOWN_ENDPOINT");
    for (const code of quoted)
      expect(REASON_CODES as readonly string[]).toContain(code);
  });

  it("describes an unknown endpoint the way the assessment answers it", () => {
    const unknown = assessAgent({ now: new Date(), agent: null, observations: [] });
    expect(unknown).toMatchObject({
      matched: false,
      decision: "insufficient_evidence",
      confidence: "none",
    });
    expect(unknown.reasonCodes).toContain("UNKNOWN_ENDPOINT");
  });

  it("quotes assertTrusted's own message for an unknown endpoint", () => {
    expect(read("packages/sdk/src/client.ts")).toContain(
      "AgentTrust has no data for this endpoint",
    );
  });

  it("links an example that gates a connection with assertTrusted", () => {
    const local = SDK_EXAMPLE_URL.replace(
      "https://github.com/agenttrust-ai/agenttrust/blob/main/",
      "",
    );
    expect(read(local)).toContain("assertTrusted(");
  });

  it("never calls AgentTrust a certification", () => {
    const all = [SDK_FIRST_STEPS_EXAMPLE, ...GUIDE_TEXT].join(" ");
    expect(all).toContain("don't certify an endpoint's security");
    expect(all).not.toMatch(/\b(certified|certifies|guarantee)/i);
  });
});

describe.each([
  ["README.md", "## First 5 minutes\n"],
  ["packages/sdk/README.md", "## First 5 minutes\n"],
])("First 5 minutes in %s", (file, heading) => {
  const doc = read(file);
  const section = doc.split(heading)[1]?.split("\n## ")[0] ?? "";

  it("has the section", () => {
    expect(section).not.toBe("");
  });

  it("gives the install command and the example, verbatim", () => {
    expect(section).toContain("```bash\n" + SDK_INSTALL_FIRST_STEPS + "\n```");
    expect(section).toContain("```ts\n" + SDK_FIRST_STEPS_EXAMPLE + "\n```");
  });

  it("has the decision and call tables, row for row", () => {
    for (const row of SDK_DECISION_GUIDE)
      expect(section).toContain(
        `| \`${row.decision}\` | ${row.meaning} | ${row.action} |`,
      );
    for (const row of SDK_CALL_GUIDE)
      expect(section).toContain(
        `| \`${row.call}\` | ${row.when} | ${row.returns} |`,
      );
  });

  it("explains unknown endpoints and how to handle them", () => {
    expect(section).toContain("### Unknown endpoints are an answer, not an error");
    expect(section).toContain(SDK_CALL_GUIDE_NOTE);
    expect(section).toContain(SDK_UNKNOWN_ENDPOINT.intro);
    for (const result of SDK_UNKNOWN_ENDPOINT.results)
      expect(section).toContain(`- ${result}`);
    expect(section).toContain(SDK_UNKNOWN_ENDPOINT.errors);
    expect(section).toContain(SDK_UNKNOWN_ENDPOINT.handling);
  });

  it("ends with next steps", () => {
    expect(section).toContain("### Next steps");
    expect(section).toContain(SDK_EXAMPLE_URL);
    expect(section).toContain(GETTING_STARTED_URL);
  });
});

describe("First 5 minutes on /docs", () => {
  const html = renderToStaticMarkup(DocsPage());
  const raw =
    html.match(/<section id="first-5-minutes"[\s\S]*?<\/section>/)?.[0] ?? "";
  const text = flat(
    raw
      .replace(/<[^>]+>/g, " ")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">"),
  );
  // Inline <code> adds spaces around code; compare without them.
  const squash = (s: string) => flat(s).replace(/\s+([,.:;)])/g, "$1").replace(/([(])\s+/g, "$1");

  it("comes straight after the Quick Start, which stays first, and is in the page navigation", () => {
    const sections = [...html.matchAll(/<section id="([^"]+)"/g)].map((m) => m[1]);
    expect(sections.slice(0, 2)).toEqual(["quick-start", "first-5-minutes"]);
    expect(html).toContain('href="#first-5-minutes"');
  });

  it("gives the install command and the example", () => {
    expect(text).toContain(SDK_INSTALL_FIRST_STEPS);
    expect(text).toContain(flat(SDK_FIRST_STEPS_EXAMPLE));
  });

  it("has every guide sentence", () => {
    for (const row of SDK_DECISION_GUIDE) expect(text).toContain(row.decision);
    for (const row of SDK_CALL_GUIDE) expect(text).toContain(row.call);
    for (const sentence of GUIDE_TEXT)
      expect(squash(text)).toContain(squash(noTicks(sentence)));
  });

  it("links the example gate and the registration path", () => {
    expect(raw).toContain(`href="${SDK_EXAMPLE_URL}"`);
    expect(raw).toContain('href="#getting-started"');
  });
});

describe("First 5 minutes in llms.txt", () => {
  const llms = read("public/llms.txt");
  const section =
    llms.split("## First 5 minutes (TypeScript SDK)\n")[1]?.split("\n## ")[0] ??
    "";
  const indented = SDK_FIRST_STEPS_EXAMPLE.split("\n")
    .map((line) => (line ? `  ${line}` : ""))
    .join("\n");

  it("comes before the Workflow", () => {
    expect(section).not.toBe("");
    expect(llms.indexOf("## First 5 minutes")).toBeLessThan(
      llms.indexOf("## Workflow"),
    );
  });

  it("gives the install command and the example, verbatim", () => {
    expect(section).toContain(SDK_INSTALL_FIRST_STEPS);
    expect(section).toContain(indented);
  });

  it("has every guide sentence", () => {
    for (const row of SDK_DECISION_GUIDE) expect(section).toContain(row.decision);
    for (const row of SDK_CALL_GUIDE) expect(section).toContain(row.call);
    for (const sentence of GUIDE_TEXT)
      expect(flat(section)).toContain(flat(sentence));
  });

  it("ends with next steps", () => {
    expect(section).toContain("Next steps:");
    expect(section).toContain(SDK_EXAMPLE_URL);
    expect(section).toContain(GETTING_STARTED_URL);
  });
});
