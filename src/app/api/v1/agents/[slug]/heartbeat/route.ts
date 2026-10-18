import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handleHeartbeat } from "@/lib/api/agents";

export const dynamic = "force-dynamic";

// Database work only, answered in well under a second; this bounds a
// request that would otherwise hold a function (and its memory) open.
export const maxDuration = 15;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  return handleHeartbeat(db, request, slug);
}
