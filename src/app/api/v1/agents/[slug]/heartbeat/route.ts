import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handleHeartbeat } from "@/lib/api/agents";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  return handleHeartbeat(db, request, slug);
}
