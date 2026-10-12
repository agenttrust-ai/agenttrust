import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { timingSafeEqual, createHash } from "node:crypto";
import { env } from "@/lib/config.server";
import { db } from "@/lib/db";
import {
  importMcpRegistryAgents,
  MCP_DISCOVERY_DAILY_INSERT_CAP,
} from "@/lib/discovery/import-mcp-registry-agents";
import {
  isDemandCoverageEnabled,
  processObservationQueue,
  type ObservationProcessSummary,
} from "@/lib/coverage/observation";

// Never statically rendered/cached — this is invoked by Vercel Cron, not a browser.
export const dynamic = "force-dynamic";

const FETCH_LIMIT = 50;

/**
 * Constant-time comparison for the cron bearer token — see
 * src/app/api/internal/cron/run-health-checks/route.ts for the identical
 * pattern and the reasoning behind hashing both sides first.
 */
function safeEqual(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

/**
 * Not part of the public API surface — /api/internal/* is only ever called
 * by Vercel Cron (which sends `Authorization: Bearer $CRON_SECRET`
 * automatically) or manually by an operator holding that same secret. No
 * user session or API key can reach this route.
 *
 * The response is deliberately counts-only — never candidate names, URLs,
 * or rejection detail — so nothing about a discovered (and not yet
 * publicly listed until inserted) endpoint leaks through a cron log/response
 * beyond how many were seen and what happened to them.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !safeEqual(authHeader, `Bearer ${env.CRON_SECRET}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Demand first, within the same daily cap the import below then counts
  // against: endpoints callers asked about are looked up before discovery
  // continues paging. Off unless enabled; its failure never blocks the import.
  let observation: ObservationProcessSummary | null = null;
  if (isDemandCoverageEnabled()) {
    try {
      observation = await processObservationQueue(db, { insertLimit: MCP_DISCOVERY_DAILY_INSERT_CAP });
    } catch (error) {
      console.error(
        "Observation queue processing failed:",
        error instanceof Error ? error.name : "unknown error",
      );
    }
  }

  try {
    const summary = await importMcpRegistryAgents(db, {
      fetchLimit: FETCH_LIMIT,
      insertLimit: MCP_DISCOVERY_DAILY_INSERT_CAP,
    });
    return NextResponse.json({
      ok: true,
      sourceCandidates: summary.sourceCandidates,
      validCandidates: summary.validCandidates,
      insertedCount: summary.inserted.length,
      rejectedCount: summary.rejected.length,
      duplicatesSkippedCount: summary.duplicatesSkipped.length,
      cappedBeforeInsertCount: summary.cappedBeforeInsert.length,
      errorCount: summary.errors.length,
      pagesRead: summary.pagesRead,
      stoppedReason: summary.stoppedReason,
      progressSaved: summary.progressSaved,
      // Present only when the queue processor ran, so the response is
      // unchanged while demand coverage is off. Counts only.
      ...(observation ? { observation } : {}),
    });
  } catch (error) {
    console.error("MCP agent discovery cron run failed:", error);
    return NextResponse.json(
      { ok: false, error: "Internal error" },
      { status: 500 },
    );
  }
}
