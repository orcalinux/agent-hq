import { describe, expect, it } from 'vitest';
import { fmtSize, updateButtonState } from '../../src/desktop/updateView';
import { DEFAULT_UPDATE_PREFS, type UpdateState } from '../../src/desktop/types';

const at = (status: UpdateState['status'], extra: Partial<UpdateState> = {}): UpdateState => ({ status, current: '0.3.0', ...extra });

describe('title bar Update button', () => {
  it('shows once an update is ready, found or failed, and stays away otherwise', () => {
    const p = DEFAULT_UPDATE_PREFS;
    expect(updateButtonState(at('ready', { version: '0.4.0' }), p, false)).toBe('ready');
    expect(updateButtonState(at('ready', { version: '0.4.0', waiting: true }), p, false)).toBe('waiting');
    expect(updateButtonState(at('available', { version: '0.4.0' }), p, false)).toBe('available');
    expect(updateButtonState(at('error', { version: '0.4.0' }), p, false)).toBe('failed');
    expect(updateButtonState(at('error'), p, false)).toBeNull();
    expect(updateButtonState(at('downloading', { version: '0.4.0' }), p, false)).toBeNull();
    expect(updateButtonState(at('downloading', { version: '0.4.0' }), p, true)).toBe('downloading');
    for (const s of ['idle', 'checking', 'up-to-date', 'unsupported'] as const) expect(updateButtonState(at(s), p, false)).toBeNull();
    expect(updateButtonState(null, p, false)).toBeNull();
  });

  it('respects the setting and the 3-day hide, which a newer version lifts', () => {
    const now = 1_000_000;
    const ready = at('ready', { version: '0.4.0' });
    expect(updateButtonState(ready, { ...DEFAULT_UPDATE_PREFS, showButton: false }, false, now)).toBeNull();
    const hidden = { ...DEFAULT_UPDATE_PREFS, hiddenUntil: now + 1, hiddenVersion: '0.4.0' };
    expect(updateButtonState(ready, hidden, false, now)).toBeNull();
    expect(updateButtonState(at('ready', { version: '0.5.0' }), hidden, false, now)).toBe('ready');
    expect(updateButtonState(ready, { ...hidden, hiddenUntil: now - 1 }, false, now)).toBe('ready');
  });

  it('formats download sizes', () => {
    expect(fmtSize(98_400_000)).toBe('98.4 MB');
    expect(fmtSize(1_500)).toBe('2 KB');
    expect(fmtSize(undefined)).toBe('');
  });
});
