import "server-only";
import { NextResponse } from "next/server";
import { toAppError } from "@/lib/errors";

/**
 * Every successful /api/v1 response is `{ data: ... }`, optionally with a
 * `pagination` sibling — one envelope shape across every endpoint, rather
 * than each route inventing its own.
 */
export function apiSuccess<T>(
  data: T,
  options?: { status?: number; pagination?: { nextCursor: string | null } },
) {
  const body = options?.pagination
    ? { data, pagination: options.pagination }
    : { data };
  return NextResponse.json(body, { status: options?.status ?? 200 });
}

/**
 * Every error response is `AppError`'s own `{ error: { code, message,
 * details? } }` shape — the same taxonomy already used by Server Actions,
 * so there's exactly one error format across the whole app, not a second
 * one invented for the API. `toAppError` guarantees an unrecognized/raw
 * error never leaks internal detail (message, stack, connection info) into
 * the response.
 */
export function apiError(error: unknown) {
  const appError = toAppError(error);
  return NextResponse.json(appError.toJSON(), { status: appError.status });
}
