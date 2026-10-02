import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SUPPORT_EMAIL } from "@/lib/contact";
import { CALLER_KEY_PERIOD_DAYS, TELEMETRY_RETENTION_DAYS } from "@/lib/telemetry/trust-check-events";
import { SiteFooter } from "@/components/shell/site-footer";
import DocsPage from "../docs/page";
import sitemap from "../sitemap";
import PrivacyPage, { metadata } from "./page";

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

describe("/privacy", () => {
  const html = renderToStaticMarkup(PrivacyPage());
  const body = text(html);

  it("is canonical at /privacy", () => {
    expect(metadata.alternates?.canonical).toBe("/privacy");
  });

  it("publishes the support, privacy and security contact as a mailto link", () => {
    expect(html).toContain(`href="mailto:${SUPPORT_EMAIL}"`);
    expect(body).toMatch(/report a security issue/i);
  });

  it("states the data handling the code actually does", () => {
    expect(body).toContain("We never contact that URL during a check");
    expect(body).toContain(`changes every ${CALLER_KEY_PERIOD_DAYS} days`);
    expect(body).toContain(`deleted after ${TELEMETRY_RETENTION_DAYS} days`);
    expect(body).toMatch(/do not store the raw IP address/);
    expect(body).toMatch(/secret key that changes every day/);
    expect(body).toMatch(/AES-256-GCM/);
    expect(body).toMatch(/do not receive, request or store conversation content/);
  });

  it("covers both MCP endpoints", () => {
    expect(body).toContain("/api/mcp");
    expect(body).toContain("/api/mcp/public");
  });
});

describe("links to /privacy and the support contact", () => {
  it("the site footer links to /privacy", () => {
    expect(renderToStaticMarkup(SiteFooter())).toContain('href="/privacy"');
  });

  it("the sitemap lists /privacy", () => {
    expect(sitemap().some((entry) => entry.url.endsWith("/privacy"))).toBe(true);
  });

  it("/docs documents the public connector endpoint and the support contact", () => {
    const html = renderToStaticMarkup(DocsPage());
    expect(html).toContain("https://getagenttrust.com/api/mcp/public");
    expect(html).toContain(`href="mailto:${SUPPORT_EMAIL}"`);
    expect(html).toContain('href="#support"');
    expect(html).toContain('href="/privacy"');
  });
});
