import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/discovery/import-mcp-registry-agents", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/discovery/import-mcp-registry-agents")
  >("@/lib/discovery/import-mcp-registry-agents");
  return { ...actual, importMcpRegistryAgents: vi.fn() };
});

import { importMcpRegistryAgents } from "@/lib/discovery/import-mcp-registry-agents";
import { env } from "@/lib/config.server";
import { GET } from "./route";

const mockedImport = vi.mocked(importMcpRegistryAgents);

function requestWith(authHeader?: string): NextRequest {
  const headers = new Headers();
  if (authHeader !== undefined) headers.set("authorization", authHeader);
  return new NextRequest(
    "https://example.com/api/internal/cron/discover-mcp-agents",
    { headers },
  );
}

beforeEach(() => {
  mockedImport.mockReset();
  mockedImport.mockResolvedValue({
    sourceCandidates: 0,
    validCandidates: 0,
    inserted: [],
    rejected: [],
    duplicatesSkipped: [],
    cappedBeforeInsert: [],
    errors: [],
  });
});

describe("GET /api/internal/cron/discover-mcp-agents — authentication", () => {
  it("accepts the correct CRON_SECRET bearer token and runs the import", async () => {
    const res = await GET(requestWith(`Bearer ${env.CRON_SECRET}`));
    expect(res.status).toBe(200);
    expect(mockedImport).toHaveBeenCalledOnce();
  });

  it("rejects a missing Authorization header, without running the import", async () => {
    const res = await GET(requestWith(undefined));
    expect(res.status).toBe(401);
    expect(mockedImport).not.toHaveBeenCalled();
  });

  it("rejects an incorrect secret of the same shape", async () => {
    const res = await GET(requestWith("Bearer " + "x".repeat(env.CRON_SECRET.length)));
    expect(res.status).toBe(401);
    expect(mockedImport).not.toHaveBeenCalled();
  });

  it("rejects a header missing the 'Bearer ' prefix", async () => {
    const res = await GET(requestWith(env.CRON_SECRET));
    expect(res.status).toBe(401);
  });

  it("rejects an empty Authorization header", async () => {
    const res = await GET(requestWith(""));
    expect(res.status).toBe(401);
  });

  it("returns 500, not a crash, when the import run itself throws", async () => {
    mockedImport.mockRejectedValueOnce(new Error("registry unreachable"));
    const res = await GET(requestWith(`Bearer ${env.CRON_SECRET}`));
    expect(res.status).toBe(500);
  });
});

describe("GET /api/internal/cron/discover-mcp-agents — response shape", () => {
  it("returns counts only — no candidate names, URLs, or rejection detail", async () => {
    mockedImport.mockResolvedValueOnce({
      sourceCandidates: 5,
      validCandidates: 4,
      inserted: [
        { id: "a", endpointUrl: "https://should-not-appear.example.com" } as never,
      ],
      rejected: [
        { externalRegistryId: "x", name: "should-not-appear", reason: "validation_failed" },
      ],
      duplicatesSkipped: [],
      cappedBeforeInsert: [],
      errors: [],
    });

    const res = await GET(requestWith(`Bearer ${env.CRON_SECRET}`));
    const body = await res.json();

    expect(body).toEqual({
      ok: true,
      sourceCandidates: 5,
      validCandidates: 4,
      insertedCount: 1,
      rejectedCount: 1,
      duplicatesSkippedCount: 0,
      cappedBeforeInsertCount: 0,
      errorCount: 0,
    });
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("should-not-appear");
  });
});
