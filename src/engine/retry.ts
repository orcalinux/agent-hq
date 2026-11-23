import { isQuotaError } from './failover';

/** Retries after the first attempt. Quota and rate-limit errors are never retried here; they reroute to another provider. */
export const MAX_TRANSIENT_RETRIES = 2;
export const RETRY_BASE_MS = 1000;
export const RETRY_MAX_MS = 20_000;

const TRANSIENT_PATTERNS = [
  /^HTTP (500|502|503|504)\b/,
  /^Could not reach /,
  /ECONNRESET|ETIMEDOUT|EPIPE|socket hang up/i,
  /network (error|connection)/i,
  /timed out|timeout/i,
  /temporarily unavailable/i,
  /\bterminated\b/i,
];

/** True for failures that usually go away on their own: server errors and dropped connections. */
export function isTransientError(message: string): boolean {
  if (isQuotaError(message)) return false;
  return TRANSIENT_PATTERNS.some((pattern) => pattern.test(message));
}

/** Exponential backoff with up to 25% jitter. `attempt` starts at 1 for the first retry. */
export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.75 + random() * 0.5));
}

/** Resolves after `ms`, or rejects with an AbortError as soon as the signal aborts. */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    };
    if (signal.aborted) return abort();
    timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
