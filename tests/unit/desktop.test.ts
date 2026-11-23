import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { deepLinkFromArgv, parseDeepLink } from '../../electron/deepLink';
import { DEFAULT_WINDOW, fitToDisplays, loadWindowState, MIN_SIZE, saveWindowState } from '../../electron/windowState';

describe('agenthq:// links', () => {
  it('opens absolute project folders only', () => {
    expect(parseDeepLink('agenthq://open?path=%2Fhome%2Fme%2Fapp')).toEqual({ type: 'open-project', path: '/home/me/app' });
    expect(parseDeepLink('agenthq://open?path=C%3A%5Ccode%5Capp')).toEqual({ type: 'open-project', path: 'C:\\code\\app' });
    expect(parseDeepLink('agenthq://open?path=relative%2Fdir')).toBeNull();
    expect(parseDeepLink('agenthq://open')).toBeNull();
    expect(parseDeepLink('agenthq://open?path=%2Ftmp%00x')).toBeNull();
  });

  it('navigates to known views only', () => {
    expect(parseDeepLink('agenthq://view/agents')).toEqual({ type: 'navigate', view: 'agents' });
    expect(parseDeepLink('agenthq://view/Tasks')).toEqual({ type: 'navigate', view: 'tasks' });
    expect(parseDeepLink('agenthq://view/evil')).toBeNull();
  });

  it('rejects other schemes, commands and junk', () => {
    expect(parseDeepLink('https://view/agents')).toBeNull();
    expect(parseDeepLink('agenthq://run?cmd=rm')).toBeNull();
    expect(parseDeepLink('not a url')).toBeNull();
  });

  it('finds the link among command-line arguments', () => {
    expect(deepLinkFromArgv(['/opt/agent-hq', '--flag', 'agenthq://view/tasks'])).toBe('agenthq://view/tasks');
    expect(deepLinkFromArgv(['/opt/agent-hq'])).toBeUndefined();
  });
});

describe('window state', () => {
  const screenA = { x: 0, y: 0, width: 1920, height: 1080 };

  it('keeps a window that is on a screen', () => {
    expect(fitToDisplays({ x: 100, y: 80, width: 1400, height: 900, maximized: false }, [screenA])).toMatchObject({ x: 100, y: 80 });
  });

  it('re-centers a window whose screen is gone', () => {
    const fitted = fitToDisplays({ x: 2500, y: 100, width: 1400, height: 900, maximized: false }, [screenA]);
    expect(fitted.x).toBeUndefined();
    expect(fitted.y).toBeUndefined();
  });

  it('shrinks a window larger than the biggest screen', () => {
    const fitted = fitToDisplays({ x: 0, y: 0, width: 3000, height: 2000, maximized: false }, [screenA]);
    expect(fitted).toMatchObject({ width: 1920, height: 1080 });
  });

  it('restores side-by-side and top/bottom tiled sizes without enlarging them', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hq-tiled-')), 'window-state.json');
    for (const size of [{ width: 640, height: 720 }, { width: 1280, height: 360 }]) {
      const state = { x: 0, y: 0, ...size, maximized: false };
      saveWindowState(file, state);
      expect(loadWindowState(file)).toEqual(state);
    }
  });

  it('round-trips through a file and survives a broken one', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hq-ws-')), 'nested', 'window-state.json');
    expect(loadWindowState(file)).toEqual(DEFAULT_WINDOW);
    saveWindowState(file, { x: 10, y: 20, width: 1200, height: 800, maximized: true });
    expect(loadWindowState(file)).toEqual({ x: 10, y: 20, width: 1200, height: 800, maximized: true });
    fs.writeFileSync(file, '{"width": 10, "height": "x"');
    expect(loadWindowState(file)).toEqual(DEFAULT_WINDOW);
    fs.writeFileSync(file, JSON.stringify({ width: 10, height: 10 }));
    expect(loadWindowState(file)).toMatchObject({ width: MIN_SIZE.width, height: MIN_SIZE.height });
  });
});
