import { describe, expect, it } from 'vitest';
import { clampSize, createTerminal, defaultShell, MAX_SESSIONS, TerminalError, closeAllTerminals, listTerminals, writeTerminal } from '../../server/pty';
import os from 'os';

const TMP = os.tmpdir();

describe('integrated terminal helpers', () => {
  it('keeps terminal dimensions inside sane bounds', () => {
    expect(clampSize(99999, -4)).toEqual({ cols: 500, rows: 2 });
    expect(clampSize('abc', undefined)).toEqual({ cols: 80, rows: 24 });
    expect(clampSize(120.4, 30)).toEqual({ cols: 120, rows: 30 });
  });

  it('prefers the configured shell and falls back to a usable one', () => {
    expect(defaultShell('linux', { SHELL: '/bin/sh' })).toBe('/bin/sh');
    expect(defaultShell('linux', { SHELL: 'relative-shell' })).toMatch(/^\/bin\/(bash|sh)$/);
    expect(defaultShell('win32', { COMSPEC: 'C:\\Windows\\System32\\cmd.exe' })).toBe('C:\\Windows\\System32\\cmd.exe');
  });

  it('starts a real shell in the requested folder and rejects bad input', async () => {
    const session = await createTerminal({ cwd: TMP });
    expect(session.cwd).toBe(TMP);
    expect(listTerminals().map((s) => s.id)).toContain(session.id);
    expect(() => writeTerminal(session.id, 42)).toThrow(TerminalError);
    expect(() => writeTerminal('missing', 'ls')).toThrow(/no longer running/);
    await expect(createTerminal({ cwd: '/definitely/not/here' })).rejects.toThrow(/does not exist/);
    closeAllTerminals();
    expect(listTerminals()).toEqual([]);
  });

  it('limits how many terminals can be open', async () => {
    for (let index = 0; index < MAX_SESSIONS; index++) await createTerminal({ cwd: TMP });
    await expect(createTerminal({ cwd: TMP })).rejects.toThrow(/At most/);
    closeAllTerminals();
  });
});
