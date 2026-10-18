import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handleListAgents } from "@/lib/api/agents";

// Authorization-scoped responses must never be cached by a shared cache.
export const dynamic = "force-dynamic";

// Database work only, answered in well under a second; this bounds a
// request that would otherwise hold a function (and its memory) open.
export const maxDuration = 15;

export async function GET(request: NextRequest) {
  return handleListAgents(db, request);
}
