import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const magpieQuotas = vi.fn();
vi.mock('@/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/client')>()), api: { magpieQuotas } }));

const reading = (remaining: number) => ({ ok: true, quotas: [{ provider: 'codex', name: 'Codex', kind: 'subscription', windows: [{ name: '5 hours', remaining }] }] });

describe('live Magpie quotas', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    magpieQuotas.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('reuses a fresh reading, refetches after the TTL, and always refetches when forced', async () => {
    const { useMagpieStore, QUOTA_TTL_MS } = await import('@/store/useMagpieStore');
    magpieQuotas.mockResolvedValueOnce(reading(7)).mockResolvedValueOnce(reading(0)).mockResolvedValueOnce(reading(5));
    await useMagpieStore.getState().loadQuotas();
    await useMagpieStore.getState().loadQuotas();
    expect(magpieQuotas).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(QUOTA_TTL_MS + 1);
    await useMagpieStore.getState().loadQuotas();
    expect(useMagpieStore.getState().quotas[0].windows[0].remaining).toBe(0);
    await useMagpieStore.getState().loadQuotas(true);
    expect(magpieQuotas).toHaveBeenCalledTimes(3);
    expect(useMagpieStore.getState().quotas[0].windows[0].remaining).toBe(5);
  });

  it('shares one request between ordinary callers, and a forced read never reuses an older answer', async () => {
    const { useMagpieStore } = await import('@/store/useMagpieStore');
    magpieQuotas.mockResolvedValue(reading(40));
    await Promise.all([useMagpieStore.getState().loadQuotas(), useMagpieStore.getState().loadQuotas()]);
    expect(magpieQuotas).toHaveBeenCalledTimes(1);

    magpieQuotas.mockReset();
    let release: (value: unknown) => void = () => undefined;
    magpieQuotas.mockImplementationOnce(() => new Promise((resolve) => (release = resolve))).mockResolvedValueOnce(reading(0));
    const slow = useMagpieStore.getState().loadQuotas(true);
    const forced = useMagpieStore.getState().loadQuotas(true);
    const forcedToo = useMagpieStore.getState().loadQuotas(true);
    release(reading(7));
    await Promise.all([slow, forced, forcedToo]);
    expect(magpieQuotas).toHaveBeenCalledTimes(2);
    expect(useMagpieStore.getState().quotas[0].windows[0].remaining).toBe(0);
  });

  it('keeps the last reading but reports the error when a refresh fails, and clears it on success', async () => {
    const { useMagpieStore } = await import('@/store/useMagpieStore');
    magpieQuotas.mockResolvedValueOnce(reading(26));
    await useMagpieStore.getState().loadQuotas(true);
    const firstAt = useMagpieStore.getState().quotasAt;
    magpieQuotas.mockRejectedValueOnce(new Error('Magpie did not answer in time.'));
    await useMagpieStore.getState().loadQuotas(true);
    expect(useMagpieStore.getState().quotaError).toMatch(/did not answer/);
    expect(useMagpieStore.getState().quotas[0].windows[0].remaining).toBe(26);
    expect(useMagpieStore.getState().quotasAt).toBe(firstAt);
    magpieQuotas.mockResolvedValueOnce(reading(0));
    await useMagpieStore.getState().loadQuotas(true);
    expect(useMagpieStore.getState().quotaError).toBeNull();
    expect(useMagpieStore.getState().quotas[0].windows[0].remaining).toBe(0);
  });
});
