import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buttonClass } from "./button";
import { cx } from "./cx";
import { StatusChip } from "./status-chip";
import { FormError, TextField, inputBaseClass, inputClass } from "./text-field";
import { StatusPill } from "@/components/agents/status-pill";
import { CheckStatusPill } from "@/components/agents/check-status-pill";
import { isNavActive } from "@/components/shell/nav-active";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("cx", () => {
  it("joins truthy class names only", () => {
    expect(cx("a", false, null, undefined, "", "b")).toBe("a b");
  });
});

describe("buttonClass", () => {
  it("includes hover, pressed and disabled states for every variant", () => {
    for (const variant of ["primary", "secondary", "ghost"] as const) {
      const c = buttonClass({ variant });
      expect(c).toContain("hover:");
      expect(c).toContain("active:");
      expect(c).toContain("disabled:");
    }
  });

  it("gives the large size a 44px touch target", () => {
    expect(buttonClass({ size: "lg" })).toContain("h-11");
  });
});

describe("StatusChip", () => {
  it("always renders an icon and the text label, never color alone", () => {
    for (const tone of ["positive", "negative", "caution", "neutral", "info"] as const) {
      const out = html(StatusChip({ tone, children: "Label" }));
      expect(out).toContain("<svg");
      expect(out).toContain('aria-hidden="true"');
      expect(out).toContain("Label");
      expect(out).toContain(`data-tone="${tone}"`);
    }
  });

  it("uses a different icon shape per tone", () => {
    const shapes = new Set(
      (["positive", "negative", "caution", "neutral", "info"] as const).map((tone) =>
        /<svg[\s\S]*<\/svg>/.exec(html(StatusChip({ tone, children: "x" })))![0],
      ),
    );
    expect(shapes.size).toBe(5);
  });
});

describe("StatusPill", () => {
  it.each([
    ["healthy", "Healthy", "positive"],
    ["degraded", "Degraded", "caution"],
    ["down", "Down", "negative"],
    ["unknown", "Not yet monitored", "neutral"],
  ])("%s → %s (%s)", (status, label, tone) => {
    const out = html(createElement(StatusPill, { status }));
    expect(out).toContain(label);
    expect(out).toContain(`data-tone="${tone}"`);
  });

  it("renders an unrecognised status as-is, neutral", () => {
    const out = html(createElement(StatusPill, { status: "mystery" }));
    expect(out).toContain("mystery");
    expect(out).toContain('data-tone="neutral"');
  });
});

describe("CheckStatusPill", () => {
  it("is positive only for success and keeps existing labels", () => {
    expect(html(createElement(CheckStatusPill, { status: "success" }))).toContain(
      'data-tone="positive"',
    );
    const timeout = html(createElement(CheckStatusPill, { status: "timeout" }));
    expect(timeout).toContain("Timeout");
    expect(timeout).toContain('data-tone="negative"');
  });
});

describe("TextField", () => {
  it("links the label, and has no describedby/invalid without hint or error", () => {
    const out = html(createElement(TextField, { id: "email", label: "Email", name: "email" }));
    expect(out).toContain('for="email"');
    expect(out).toContain('id="email"');
    // Attribute checks — the class list legitimately contains the
    // `aria-invalid:` Tailwind variant, so match the attribute syntax.
    expect(out).not.toContain('aria-describedby="');
    expect(out).not.toContain('aria-invalid="');
  });

  it("wires hint and error to the input via aria-describedby and marks it invalid", () => {
    const out = html(
      createElement(TextField, {
        id: "password",
        label: "Password",
        hint: "At least 8 characters.",
        error: "Too short.",
      }),
    );
    expect(out).toContain('aria-describedby="password-hint password-error"');
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain('id="password-hint"');
    expect(out).toContain('id="password-error"');
    expect(out).toContain("Too short.");
  });

  it("announces form-level errors", () => {
    expect(html(createElement(FormError, null, "Invalid credentials."))).toContain('role="alert"');
  });
});

describe("input classes", () => {
  it("keeps height out of the base class so multi-line controls never get two conflicting height utilities", () => {
    expect(inputBaseClass).not.toMatch(/(^|\s)h-\S+/);
    expect(inputClass).toContain(inputBaseClass);
    expect(inputClass.match(/(^|\s)h-\S+/g)).toEqual([" h-10"]);
  });
});

describe("isNavActive", () => {
  it("keeps the signed-in Dashboard link (non-exact) current on every nested dashboard route", () => {
    for (const path of ["/dashboard", "/dashboard/agents", "/dashboard/agents/support-bot/health", "/dashboard/api-keys"]) {
      expect(isNavActive(path, "/dashboard")).toBe(true);
    }
    expect(isNavActive("/docs", "/dashboard")).toBe(false);
  });

  it("matches the route itself and nested routes", () => {
    expect(isNavActive("/docs", "/docs")).toBe(true);
    expect(isNavActive("/dashboard/agents/abc", "/dashboard/agents")).toBe(true);
    expect(isNavActive("/dashboard/agents-archive", "/dashboard/agents")).toBe(false);
  });

  it("matches exact items only on their own path", () => {
    expect(isNavActive("/dashboard", "/dashboard", { exact: true })).toBe(true);
    expect(isNavActive("/dashboard/agents", "/dashboard", { exact: true })).toBe(false);
  });

  it("never marks an in-page anchor link or an unknown path as current", () => {
    expect(isNavActive("/docs", "/docs#mcp")).toBe(false);
    expect(isNavActive(null, "/docs")).toBe(false);
  });
});
