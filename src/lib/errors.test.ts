import { describe, expect, it, vi } from "vitest";
import { AppError, ErrorCode, toAppError } from "./errors";

describe("AppError", () => {
  it("maps each code to its HTTP status", () => {
    expect(new AppError(ErrorCode.NOT_FOUND, "nope").status).toBe(404);
    expect(new AppError(ErrorCode.VALIDATION_ERROR, "bad").status).toBe(400);
    expect(new AppError(ErrorCode.RATE_LIMITED, "slow down").status).toBe(429);
  });

  it("serializes to the shared { error } shape", () => {
    const err = new AppError(ErrorCode.CONFLICT, "duplicate slug", {
      slug: "acme",
    });
    expect(err.toJSON()).toEqual({
      error: {
        code: "CONFLICT",
        message: "duplicate slug",
        details: { slug: "acme" },
      },
    });
  });
});

describe("toAppError", () => {
  it("passes an existing AppError through unchanged", () => {
    const original = new AppError(ErrorCode.FORBIDDEN, "no");
    expect(toAppError(original)).toBe(original);
  });

  it("converts an unknown error into a sanitized INTERNAL_ERROR", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = toAppError(new Error("leaked connection string details"));

    expect(result.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(result.status).toBe(500);
    expect(result.message).not.toContain("connection string");
    spy.mockRestore();
  });
});
