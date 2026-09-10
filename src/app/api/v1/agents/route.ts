import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handleListAgents } from "@/lib/api/agents";

// Authorization-scoped responses must never be cached by a shared cache.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handleListAgents(db, request);
}
