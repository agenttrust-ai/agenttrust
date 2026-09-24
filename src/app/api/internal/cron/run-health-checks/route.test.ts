import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/monitoring/run-batch", async () => {
  const actual = await vi.importActual<typeof import("@/lib/monitoring/run-batch")>(
    "@/lib/monitoring/run-batch",
  );
  return { ...actual, runHealthCheckBatch: vi.fn() };
});

import {
  HEALTH_CHECK_MAX_AGENTS_PER_RUN,
  runHealthCheckBatch,
} from "@/lib/monitoring/run-batch";
import { env } from "@/lib/config.server";
import { GET } from "./route";

const mockedRunHealthCheckBatch = vi.mocked(runHealthCheckBatch);

function requestWith(authHeader?: string): NextRequest {
  const headers = new Headers();
  if (authHeader !== undefined) headers.set("authorization", authHeader);
  return new NextRequest("https://example.com/api/internal/cron/run-health-checks", {
    headers,
  });
}

beforeEach(() => {
  mockedRunHealthCheckBatch.mockReset();
  mockedRunHealthCheckBatch.mockResolvedValue({
    claimed: 0,
    succeeded: 0,
    failed: 0,
    statusChanges: 0,
    deferred: 0,
    stoppedReason: "drained",
    elapsedMs: 0,
  });
});

describe("GET /api/internal/cron/run-health-checks — authentication", () => {
  it("accepts the correct CRON_SECRET bearer token and runs the batch", async () => {
    const res = await GET(requestWith(`Bearer ${env.CRON_SECRET}`));
    expect(res.status).toBe(200);
    expect(mockedRunHealthCheckBatch).toHaveBeenCalledOnce();
  });

  it("runs up to the per-run agent cap (500)", async () => {
    await GET(requestWith(`Bearer ${env.CRON_SECRET}`));
    expect(HEALTH_CHECK_MAX_AGENTS_PER_RUN).toBe(500);
    expect(mockedRunHealthCheckBatch).toHaveBeenCalledWith(expect.anything(), 500);
  });

  it("rejects a missing Authorization header, without running the batch", async () => {
    const res = await GET(requestWith(undefined));
    expect(res.status).toBe(401);
    expect(mockedRunHealthCheckBatch).not.toHaveBeenCalled();
  });

  it("rejects an incorrect secret of the same shape", async () => {
    const res = await GET(requestWith("Bearer " + "x".repeat(env.CRON_SECRET.length)));
    expect(res.status).toBe(401);
    expect(mockedRunHealthCheckBatch).not.toHaveBeenCalled();
  });

  it("rejects a secret of a different length than the real one without throwing (regression: hash-first comparison avoids timingSafeEqual's equal-length requirement)", async () => {
    const res = await GET(requestWith("Bearer short"));
    expect(res.status).toBe(401);
  });

  it("rejects a header missing the 'Bearer ' prefix", async () => {
    const res = await GET(requestWith(env.CRON_SECRET));
    expect(res.status).toBe(401);
  });

  it("rejects an empty Authorization header", async () => {
    const res = await GET(requestWith(""));
    expect(res.status).toBe(401);
  });

  it("returns 500, not a crash, when the batch run itself throws", async () => {
    mockedRunHealthCheckBatch.mockRejectedValueOnce(new Error("boom"));
    const res = await GET(requestWith(`Bearer ${env.CRON_SECRET}`));
    expect(res.status).toBe(500);
  });
});
