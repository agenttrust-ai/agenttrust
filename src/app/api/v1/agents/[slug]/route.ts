import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handleGetAgent } from "@/lib/api/agents";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  return handleGetAgent(db, request, slug);
}
