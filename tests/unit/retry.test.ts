import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { abortableSleep, isTransientError, MAX_TRANSIENT_RETRIES, retryDelayMs, RETRY_MAX_MS } from '@/engine/retry';

describe('transient error classification', () => {
  it('retries server errors and dropped connections', () => {
    for (const message of ['HTTP 500: boom', 'HTTP 502', 'HTTP 503: unavailable', 'HTTP 504', 'Could not reach api.example.com.', 'read ECONNRESET', 'socket hang up', 'The request timed out', 'terminated']) {
      expect(isTransientError(message), message).toBe(true);
    }
  });
  it('never retries quota, auth, not-found or client errors', () => {
    for (const message of ['Rate limited or out of quota: slow down', 'HTTP 429', 'Authentication failed: bad key', 'Not found', 'HTTP 400: bad request', 'HTTP 503: usage limit reached', 'insufficient_quota']) {
      expect(isTransientError(message), message).toBe(false);
    }
  });
  it('allows a small bounded number of retries', () => {
    expect(MAX_TRANSIENT_RETRIES).toBe(2);
  });
});

describe('backoff', () => {
  it('doubles each attempt, is capped, and stays within 25% jitter', () => {
    expect(retryDelayMs(1, () => 0.5)).toBe(1000);
    expect(retryDelayMs(2, () => 0.5)).toBe(2000);
    expect(retryDelayMs(3, () => 0.5)).toBe(4000);
    expect(retryDelayMs(1, () => 0)).toBe(750);
    expect(retryDelayMs(1, () => 1)).toBe(1250);
    expect(retryDelayMs(30, () => 1)).toBeLessThanOrEqual(RETRY_MAX_MS * 1.25);
  });
});

describe('abortable sleep', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resolves after the delay', async () => {
    const done = vi.fn();
    void abortableSleep(1000, new AbortController().signal).then(done);
    await vi.advanceTimersByTimeAsync(999);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalled();
  });
  it('rejects with an AbortError the moment the run is stopped', async () => {
    const controller = new AbortController();
    const pending = abortableSleep(60_000, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await expect(abortableSleep(10, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
