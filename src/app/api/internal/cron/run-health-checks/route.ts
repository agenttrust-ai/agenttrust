import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { timingSafeEqual, createHash } from "node:crypto";
import { env } from "@/lib/config.server";
import { db } from "@/lib/db";
import { runHealthCheckBatch } from "@/lib/monitoring/run-batch";

// Never statically rendered/cached — this is invoked by Vercel Cron, not a browser.
export const dynamic = "force-dynamic";

const BATCH_SIZE = 20;

/**
 * Constant-time comparison for the cron bearer token — a plain `!==` leaks
 * timing information proportional to the matching prefix length. Hashing
 * both sides first also sidesteps `timingSafeEqual`'s requirement that both
 * buffers be the same length (a wrong-length guess would otherwise throw
 * before any comparison happens, which is itself a — smaller, but real —
 * timing/behavioral signal).
 */
function safeEqual(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

/**
 * Not part of the public API surface — /api/internal/* is only ever called
 * by Vercel Cron (which sends `Authorization: Bearer $CRON_SECRET`
 * automatically when CRON_SECRET is set on the project) or manually by an
 * operator holding that same secret. No user session or API key can reach
 * this route.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !safeEqual(authHeader, `Bearer ${env.CRON_SECRET}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runHealthCheckBatch(db, BATCH_SIZE);
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    console.error("Health check cron run failed:", error);
    return NextResponse.json(
      { ok: false, error: "Internal error" },
      { status: 500 },
    );
  }
}
