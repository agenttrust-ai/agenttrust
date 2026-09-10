import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handleGetAgentHealth } from "@/lib/api/agents";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  return handleGetAgentHealth(db, request, slug);
}
