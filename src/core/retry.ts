export interface RetryOptions {
  /** Total tries, including the first one. */
  attempts: number;
  /** Delay before the 2nd try, doubled each time up to `maxDelayMs`. */
  baseDelayMs: number;
  maxDelayMs?: number;
  /** Return false to stop retrying (e.g. the error is not transient). */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export function backoffDelay(attempt: number, baseDelayMs: number, maxDelayMs = 30_000): number {
  // attempt 1 failed -> wait base, attempt 2 failed -> 2*base, ...
  return Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt - 1));
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Run `fn` until it resolves or the attempts run out; rethrows the last error. */
export async function retry<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const more = attempt < options.attempts && (options.shouldRetry?.(error, attempt) ?? true);
      if (!more) break;
      await sleep(backoffDelay(attempt, options.baseDelayMs, options.maxDelayMs));
    }
  }
  throw lastError;
}
