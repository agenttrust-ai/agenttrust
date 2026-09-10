/**
 * Central error taxonomy, shared by every surface (REST, MCP, Server Actions)
 * added in later phases. Defined now so nothing downstream invents its own
 * ad hoc error shape.
 */
export const ErrorCode = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

/**
 * Thrown by domain/lib code. `message` is always safe to show a caller —
 * anything sensitive belongs in a server-side `console.error`, not in the
 * thrown error, so a route wrapper can serialize this directly without
 * risking a leaked internal detail.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

/** Converts any thrown value into a client-safe AppError, logging the original. */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  // Never echo an unrecognized error's message back to the caller — it might
  // contain a stack trace, a connection string, or other internal detail.
  console.error(error);
  return new AppError(
    ErrorCode.INTERNAL_ERROR,
    "Something went wrong. Please try again.",
  );
}
