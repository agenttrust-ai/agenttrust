import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/server";
import type { AppDatabase } from "@/lib/db/rls";
import { registerAgentTrustTools } from "./server";

/**
 * Registration-level tests only — this project has no precedent for
 * spinning up the real Next.js HTTP route in a test (every existing test
 * runs against pglite or pure functions), so "initialize/tools/list work
 * without auth" is verified live against production instead (see the
 * project's own smoke-test process). What belongs here, and is meaningful
 * as a unit test, is that every tool -- new and existing -- is actually
 * registered on the server object `tools/list` is built from.
 */
describe("registerAgentTrustTools", () => {
  it("registers check_agent_trust alongside every pre-existing tool, unchanged", () => {
    const server = new McpServer({ name: "agenttrust", version: "1.0.0" });
    registerAgentTrustTools(server, {} as AppDatabase);

    for (const name of [
      "list_agents",
      "get_agent",
      "get_agent_health",
      "send_heartbeat",
      "check_agent_trust",
    ]) {
      expect(server.toolInputSchemaJson(name)).toBeDefined();
    }
  });

  it("check_agent_trust's registered input schema has exactly one required field: endpointUrl", () => {
    const server = new McpServer({ name: "agenttrust", version: "1.0.0" });
    registerAgentTrustTools(server, {} as AppDatabase);

    const schema = server.toolInputSchemaJson("check_agent_trust") as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    expect(Object.keys(schema.properties ?? {})).toEqual(["endpointUrl"]);
    expect(schema.required).toEqual(["endpointUrl"]);
  });
});
