import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CLAUDE_CODE_ADD_COMMAND, PUBLIC_MCP_URL } from "../docs/quick-start";
import { SDK_INSTALL } from "../docs/sdk-reference";
import { AUTHENTICATED_MCP_URL } from "../docs/mcp-clients";

// The page runs the live check only when there's an endpointUrl; these mocks
// make sure no render here can ever reach a database or the real request.
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
const mcpCheckAgentTrust = vi.hoisted(() => vi.fn());
vi.mock("@/lib/mcp/tools", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mcp/tools")>()),
  mcpCheckAgentTrust,
}));

import CheckAgentTrustPage, { metadata } from "./page";

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

async function render(endpointUrl?: string): Promise<string> {
  const page = await CheckAgentTrustPage({
    searchParams: Promise.resolve(endpointUrl ? { endpointUrl } : {}),
  } as Parameters<typeof CheckAgentTrustPage>[0]);
  return renderToStaticMarkup(page);
}

const developerSection = (html: string) =>
  html.match(
    /<section aria-labelledby="mcp-heading"[\s\S]*?<\/section>/,
  )?.[0] ?? "";

describe("/check-agent-trust developer next steps", () => {
  it("names the public no-key connector, not the keyed server", async () => {
    const section = text(developerSection(await render()));
    expect(section).toContain(`the public connector ${PUBLIC_MCP_URL}`);
    expect(section).toMatch(/no key/);
    expect(section).not.toContain(`${AUTHENTICATED_MCP_URL} `);
  });

  it("gives a runnable Claude Code command and the SDK install command", async () => {
    const section = text(developerSection(await render()));
    expect(section).toContain(CLAUDE_CODE_ADD_COMMAND);
    expect(section).toContain(SDK_INSTALL);
  });

  it("links client setup and the SDK docs, and keeps the API docs link", async () => {
    const section = developerSection(await render());
    expect(section).toContain('href="/docs#mcp-clients"');
    expect(section).toContain('href="/docs#sdk"');
    expect(section).toContain('href="/docs#mcp"');
  });

  it("keeps the rest of the page", async () => {
    const html = await render();
    expect(html).toContain('id="endpointUrl"');
    expect(html).toContain('id="how-heading"');
    expect(html).toContain('id="scope-heading"');
    expect(text(developerSection(html))).toContain(
      "No AgentTrust account or API key",
    );
    expect(text(developerSection(html))).toContain(
      "check_agent_trust({ endpointUrl:",
    );
    expect(metadata.alternates?.canonical).toBe("/check-agent-trust");
  });

  it("runs no check without an endpointUrl", async () => {
    mcpCheckAgentTrust.mockClear();
    await render();
    expect(mcpCheckAgentTrust).not.toHaveBeenCalled();
  });
});

describe("/check-agent-trust result pointer", () => {
  it("points from a result to the developer section", async () => {
    mcpCheckAgentTrust.mockResolvedValueOnce({
      content: [],
      structuredContent: { matched: false },
    });
    const html = await render("https://unknown.example.com/mcp");
    const result =
      html.match(
        /<section aria-label="Trust check result"[\s\S]*?<\/section>/,
      )?.[0] ?? "";
    expect(result).not.toBe("");
    expect(result).toContain('href="#mcp-heading"');
    expect(text(result)).toContain("Run this check from your own agent");
    // The developer section the pointer targets exists on the same page.
    expect(html).toContain('id="mcp-heading"');
  });

  it("doesn't show the pointer when the check didn't run", async () => {
    mcpCheckAgentTrust.mockResolvedValueOnce({
      content: [],
      structuredContent: { error: { message: "Something went wrong." } },
      isError: true,
    });
    const html = await render("https://unknown.example.com/mcp");
    expect(text(html)).toContain("The check didn't run");
    expect(html).not.toContain('href="#mcp-heading"');
  });
});
