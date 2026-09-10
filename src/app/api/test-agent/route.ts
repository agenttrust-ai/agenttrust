import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * A deterministic, self-contained test target — for registering an agent
 * in AgentTrust's own dashboard and exercising the full registration/
 * monitoring/heartbeat flow end-to-end against something real. Not part of
 * the AgentTrust Public API: no shared imports from src/lib/api, no auth,
 * no rate limiting, no database, no env vars, no external calls. Nothing
 * it does can affect (or be affected by) the actual product logic.
 */
export const dynamic = "force-dynamic";

const AGENT_NAME = "Support Bot";
const MAX_MESSAGE_LENGTH = 2000;

const requestSchema = z.object({
  message: z
    .string({ error: "message is required and must be a string." })
    .trim()
    .min(1, { error: "message must not be empty." })
    .max(MAX_MESSAGE_LENGTH, {
      error: `message must be ${MAX_MESSAGE_LENGTH} characters or fewer.`,
    }),
});

function errorResponse(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}

/** GET — lets AgentTrust's existing pull-based health monitor (a plain GET, unmodified) see this as healthy. */
export function GET() {
  return NextResponse.json({
    ok: true,
    agent: AGENT_NAME,
    timestamp: new Date().toISOString(),
  });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.");
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("message is required and must be a non-empty string.");
  }

  return NextResponse.json({
    ok: true,
    agent: AGENT_NAME,
    reply: `${AGENT_NAME} received: ${parsed.data.message}`,
    timestamp: new Date().toISOString(),
  });
}
