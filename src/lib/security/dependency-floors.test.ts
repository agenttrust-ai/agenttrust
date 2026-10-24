import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Security floors for installed dependencies, read from package-lock.json
 * (what Vercel installs). Each floor is the first version that fixes an
 * advisory affecting this app, so a lockfile change can't quietly bring a
 * vulnerable version back.
 */
const ROOT = path.resolve(import.meta.dirname, "../../..");
const LOCK = JSON.parse(
  fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8"),
) as { packages: Record<string, { version?: string }> };

/** Every installed copy of a package, including nested ones. */
const installed = (name: string): string[] =>
  Object.entries(LOCK.packages)
    .filter(([key]) => key.endsWith(`node_modules/${name}`))
    .map(([, entry]) => entry.version ?? "");

const atLeast = (version: string, floor: string): boolean => {
  const a = version.split(/[.-]/).slice(0, 3).map(Number);
  const b = floor.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
};

const FLOORS: [name: string, floor: string, advisories: string][] = [
  // Server Actions DoS, Image Optimization SVG RCE and SSRF, and others.
  ["next", "16.4.1", "GHSA-p3m5, GHSA-2464, GHSA-cjq9"],
  ["sharp", "0.35.5", "GHSA-wq5f"],
  ["source-map-js", "1.2.2", "GHSA-68fv"],
  // Memory exhaustion in validation (also needs the limits in
  // src/lib/mcp/request-limits.ts), shared-instance message leak.
  ["@modelcontextprotocol/server", "2.3.0", "GHSA-46jr, GHSA-jm63"],
  ["@modelcontextprotocol/core", "2.3.0", "GHSA-46jr, GHSA-jm63"],
  ["zod", "4.6.6", "GHSA-mrhx"],
  // Monitoring fetches untrusted endpoints with undici.
  ["undici", "8.12.2", "GHSA-xjj6, GHSA-4qv8, GHSA-qrxm"],
];

describe("dependency security floors (package-lock.json)", () => {
  it.each(FLOORS)("%s is at least %s (%s)", (name, floor) => {
    const versions = installed(name);
    expect(versions.length, `${name} is installed`).toBeGreaterThan(0);
    for (const version of versions) {
      expect(atLeast(version, floor), `${name}@${version}`).toBe(true);
    }
  });

  it("compares versions numerically", () => {
    expect(atLeast("16.4.3", "16.4.1")).toBe(true);
    expect(atLeast("16.4.1", "16.4.1")).toBe(true);
    expect(atLeast("16.3.4", "16.4.1")).toBe(false);
    expect(atLeast("16.10.0", "16.4.1")).toBe(true);
    expect(atLeast("1.2.1", "1.2.2")).toBe(false);
  });
});
