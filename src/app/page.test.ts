import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SiteFooter } from "@/components/shell/site-footer";
import { SDK_INSTALL, SDK_NPM_URL } from "./docs/sdk-reference";
import Home from "./page";
import { PUBLIC_MCP_URL } from "./docs/quick-start";
import { AUTHENTICATED_MCP_URL } from "./docs/mcp-clients";

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

const html = renderToStaticMarkup(Home());
const sections = html.match(/<section[\s\S]*?<\/section>/g) ?? [];
const hero = sections[0] ?? "";
const developers =
  sections.find((section) => section.includes('id="mcp-heading"')) ?? "";
const closing =
  sections.find((section) => section.includes('id="cta-heading"')) ?? "";

describe("home page TypeScript SDK discovery", () => {
  it("shows the SDK install command in the developer section", () => {
    expect(text(developers)).toContain(SDK_INSTALL);
  });

  it("links the SDK documentation and the npm package", () => {
    expect(developers).toContain('href="/docs#sdk"');
    expect(developers).toContain(`href="${SDK_NPM_URL}"`);
  });

  it("describes the SDK check accurately: anonymous, read-only, no account or API key", () => {
    const sdkLine = text(developers).split("Prefer TypeScript?")[1] ?? "";
    expect(sdkLine).toMatch(/anonymous and read-only/);
    expect(sdkLine).toMatch(/no account or API key/);
  });

  it("doesn't hard-code an SDK version", () => {
    expect(text(html)).not.toMatch(
      /@getagenttrust\/sdk@\d|sdk v?\d+\.\d+\.\d+/i,
    );
  });

  it("keeps the existing developer links", () => {
    expect(developers).toContain('href="/docs#mcp"');
    expect(developers).toContain('href="/docs#lookup"');
  });
});

describe("home page primary call to action is unchanged", () => {
  it("keeps the hero's check form first on the page, with the test-agent link", () => {
    expect(html.indexOf('id="home-endpoint-url"')).toBeGreaterThan(-1);
    expect(html.indexOf('id="home-endpoint-url"')).toBeLessThan(
      html.indexOf('id="cta-endpoint-url"'),
    );
    expect(hero).toContain('id="home-endpoint-url"');
    expect(text(hero)).toContain("Check AgentTrust's own test agent");
  });

  it("doesn't put the SDK in the hero", () => {
    expect(text(hero)).not.toContain("@getagenttrust/sdk");
    expect(hero).not.toContain("/docs#sdk");
  });

  it("keeps the closing check form and the documentation link", () => {
    expect(closing).toContain('id="cta-endpoint-url"');
    expect(html).toContain('href="/docs"');
    expect(text(html)).toContain("Read the documentation");
  });
});

describe("site footer Developers links", () => {
  const footer = renderToStaticMarkup(SiteFooter());
  const developersNav =
    footer.match(/<nav aria-label="Developers"[\s\S]*?<\/nav>/)?.[0] ?? "";

  it("adds the TypeScript SDK after the MCP server, keeping the existing links", () => {
    const links = [
      ...developersNav.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g),
    ].map((match) => [match[1], text(match[2]).trim()]);
    expect(links.map(([, label]) => label)).toEqual([
      "MCP server",
      "TypeScript SDK",
      "REST API",
      "llms.txt",
      "GitHub",
    ]);
    expect(links[1][0]).toBe("/docs#sdk");
  });
});

describe("home page MCP box: public connector first, keyed server labelled", () => {
  // The connector box runs from its eyebrow label to the keyed-tools note below it.
  const [beforeNote, fromNote = ""] = developers.split("Keyed tools (");
  const box = beforeNote.slice(beforeNote.lastIndexOf('<p class="eyebrow">'));
  const keyedNote = fromNote.split("</p>")[0];

  it("shows and copies the public no-key connector", () => {
    expect(box).not.toBe("");
    expect(text(box)).toContain(PUBLIC_MCP_URL);
    expect(text(box)).toMatch(/Public MCP connector · no key/);
    expect(box).toContain('aria-label="Copy MCP connector URL"');
  });

  it("names the authenticated server only next to its API key requirement", () => {
    expect(text(box)).not.toContain(`${AUTHENTICATED_MCP_URL} `);
    expect(text(keyedNote)).toContain(AUTHENTICATED_MCP_URL);
    expect(text(keyedNote)).toMatch(/with an API key/);
    expect(text(keyedNote)).toMatch(/list_agents.*send_heartbeat/);
    expect(keyedNote).toContain('href="/docs#mcp-clients"');
  });

  it("keeps the check_agent_trust tool-call example", () => {
    expect(text(developers)).toMatch(/"name": "check_agent_trust"/);
  });
});
