import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every route handler declares its own `maxDuration`, so none inherits the
 * project's default function timeout (300s), which would let a stuck request
 * hold a function (and its memory) open for five minutes. File-content tests:
 * the routes are read as text, not imported, so no database or env is needed.
 */
const APP_DIR = import.meta.dirname;

/** Routes allowed more than a minute: batch jobs that need the time. */
const LONG_RUNNING = new Set([
  "/api/internal/cron/run-health-checks",
  "/api/internal/cron/discover-mcp-agents",
]);
const SHORT_LIMIT_SECONDS = 60;
/** Vercel Pro's maximum without the extended-duration beta. */
const PLAN_MAX_SECONDS = 800;

/** The values chosen for each route; changing one should be deliberate. */
const EXPECTED: Record<string, number> = {
  "/api/internal/cron/run-health-checks": 300,
  "/api/internal/cron/discover-mcp-agents": 300,
  "/api/mcp": 30,
  "/api/mcp/public": 30,
  "/api/v1/agents": 15,
  "/api/v1/agents/[slug]": 15,
  "/api/v1/agents/[slug]/health": 15,
  "/api/v1/agents/[slug]/heartbeat": 15,
  "/api/v1/assessments": 15,
  "/api/test-agent": 10,
  "/auth/callback": 15,
};

function findRouteFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return findRouteFiles(full);
    return /^route\.(ts|tsx|js|mjs)$/.test(entry.name) ? [full] : [];
  });
}

/** The URL path a route file serves; route groups like `(dashboard)` aren't part of it. */
function routePath(file: string): string {
  const segments = path
    .relative(APP_DIR, path.dirname(file))
    .split(path.sep)
    .filter((segment) => segment !== "" && !/^\(.*\)$/.test(segment));
  return `/${segments.join("/")}`;
}

/** Every top-level `export const maxDuration = <number>;` in the file. */
function declaredMaxDurations(file: string): number[] {
  const source = fs.readFileSync(file, "utf8");
  return [...source.matchAll(/^export const maxDuration = ([\d_]+);$/gm)].map(
    (match) => Number(match[1].replaceAll("_", "")),
  );
}

const routes = findRouteFiles(APP_DIR).map((file) => ({
  path: routePath(file),
  durations: declaredMaxDurations(file),
}));

describe("route handler maxDuration", () => {
  it("finds every route handler (the scan itself works)", () => {
    expect(routes.map((route) => route.path).sort()).toEqual(
      expect.arrayContaining(Object.keys(EXPECTED).sort()),
    );
  });

  it.each(routes.map((route) => [route.path, route.durations] as const))(
    "%s declares exactly one numeric maxDuration",
    (_path, durations) => {
      expect(durations).toHaveLength(1);
      expect(Number.isInteger(durations[0]) && durations[0] > 0).toBe(true);
    },
  );

  it.each(routes.map((route) => [route.path, route.durations[0]] as const))(
    "%s stays within its limit (%i s)",
    (routePathname, seconds) => {
      const limit = LONG_RUNNING.has(routePathname)
        ? PLAN_MAX_SECONDS
        : SHORT_LIMIT_SECONDS;
      expect(seconds).toBeLessThanOrEqual(limit);
    },
  );

  it.each(Object.entries(EXPECTED))(
    "%s keeps its chosen maxDuration of %i s",
    (routePathname, seconds) => {
      expect(
        routes.find((route) => route.path === routePathname)?.durations,
      ).toEqual([seconds]);
    },
  );
});
