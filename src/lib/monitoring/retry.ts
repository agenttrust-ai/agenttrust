/**
 * Retry policy: a small fixed number of attempts with linear-ish backoff —
 * NOT indefinite, NOT exponential-without-cap. This runs inside one
 * scheduled cron invocation alongside a batch of other agents, so the
 * total time any single agent can spend retrying has to stay small and
 * bounded, regardless of the caller's own choices.
 *
 *   attempt 1 → (fails, retryable) → wait 300ms
 *   attempt 2 → (fails, retryable) → wait 900ms
 *   attempt 3 → final result, whatever it is
 *
 * A result the caller's `isRetryable` marks as NOT retryable (e.g. a
 * received HTTP response, or a blocked SSRF target) returns immediately on
 * the first attempt — retrying either can't change the outcome or would
 * only add load for no benefit.
 */
export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_BACKOFF_MS = [300, 900];

export type RetryOptions = {
  maxAttempts?: number;
  backoffMs?: number[];
  sleep?: (ms: number) => Promise<void>;
};

export type RetryResult<T> = {
  result: T;
  attempts: number;
};

export async function withRetry<T>(
  attempt: (attemptNumber: number) => Promise<T>,
  isRetryable: (result: T) => boolean,
  options: RetryOptions = {},
): Promise<RetryResult<T>> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  let result: T;
  for (let i = 0; i < maxAttempts; i++) {
    result = await attempt(i + 1);
    const isLastAttempt = i === maxAttempts - 1;
    if (!isRetryable(result) || isLastAttempt) {
      return { result, attempts: i + 1 };
    }
    await sleep(backoffMs[i] ?? backoffMs[backoffMs.length - 1]);
  }
  // Unreachable when maxAttempts >= 1, but keeps TypeScript satisfied.
  return { result: result!, attempts: maxAttempts };
}
