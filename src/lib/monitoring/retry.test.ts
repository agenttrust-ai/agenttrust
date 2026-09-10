import { describe, expect, it, vi } from "vitest";
import { withRetry } from "./retry";

const instantSleep = async () => {};

describe("withRetry", () => {
  it("returns immediately on the first success without retrying", async () => {
    const attempt = vi.fn().mockResolvedValue("ok");
    const { result, attempts } = await withRetry(attempt, () => false, {
      sleep: instantSleep,
    });
    expect(result).toBe("ok");
    expect(attempts).toBe(1);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("does not retry a result the caller marks as non-retryable", async () => {
    const attempt = vi.fn().mockResolvedValue("http_error");
    const { attempts } = await withRetry(attempt, () => false, {
      sleep: instantSleep,
    });
    expect(attempts).toBe(1);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("retries a retryable result up to maxAttempts, then stops", async () => {
    const attempt = vi.fn().mockResolvedValue("timeout");
    const { result, attempts } = await withRetry(attempt, () => true, {
      maxAttempts: 3,
      sleep: instantSleep,
    });
    expect(result).toBe("timeout");
    expect(attempts).toBe(3);
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it("stops retrying as soon as an attempt succeeds", async () => {
    const attempt = vi
      .fn()
      .mockResolvedValueOnce("timeout")
      .mockResolvedValueOnce("success");
    const { result, attempts } = await withRetry(
      attempt,
      (r) => r === "timeout",
      { maxAttempts: 5, sleep: instantSleep },
    );
    expect(result).toBe("success");
    expect(attempts).toBe(2);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("never exceeds maxAttempts even when every attempt is retryable", async () => {
    const attempt = vi.fn().mockResolvedValue("timeout");
    const { attempts } = await withRetry(attempt, () => true, {
      maxAttempts: 1,
      sleep: instantSleep,
    });
    expect(attempts).toBe(1);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("waits the configured backoff between retries, in order", async () => {
    const attempt = vi.fn().mockResolvedValue("timeout");
    const sleep = vi.fn().mockResolvedValue(undefined);
    await withRetry(attempt, () => true, {
      maxAttempts: 3,
      backoffMs: [100, 500],
      sleep,
    });
    expect(sleep).toHaveBeenNthCalledWith(1, 100);
    expect(sleep).toHaveBeenNthCalledWith(2, 500);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("passes the 1-indexed attempt number to each call", async () => {
    const seen: number[] = [];
    const attempt = vi.fn().mockImplementation(async (n: number) => {
      seen.push(n);
      return "timeout";
    });
    await withRetry(attempt, () => true, {
      maxAttempts: 3,
      sleep: instantSleep,
    });
    expect(seen).toEqual([1, 2, 3]);
  });
});
