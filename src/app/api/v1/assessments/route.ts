import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handleGetAssessment } from "@/lib/api/assessments";

export const dynamic = "force-dynamic";

// Database reads only, answered in well under a second; this bounds a
// request that would otherwise hold a function (and its memory) open.
export const maxDuration = 15;

export async function GET(request: NextRequest) {
  return handleGetAssessment(db, request);
}
