import fs from 'fs';
import path from 'path';

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DEFAULT_WINDOW: WindowState = { width: 1440, height: 900, maximized: false };
export const MIN_SIZE = { width: 1024, height: 640 };

export function loadWindowState(file: string): WindowState {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<WindowState>;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : undefined);
    return {
      x: num(raw.x),
      y: num(raw.y),
      width: Math.max(MIN_SIZE.width, num(raw.width) ?? DEFAULT_WINDOW.width),
      height: Math.max(MIN_SIZE.height, num(raw.height) ?? DEFAULT_WINDOW.height),
      maximized: raw.maximized === true,
    };
  } catch {
    return { ...DEFAULT_WINDOW };
  }
}

export function saveWindowState(file: string, state: WindowState): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state, null, 2));
  } catch {
    // not worth failing over
  }
}

/** Keeps a saved window on a screen that still exists; drops the position otherwise so the window is centered. */
export function fitToDisplays(state: WindowState, displays: Area[]): WindowState {
  if (state.x === undefined || state.y === undefined || !displays.length) return { ...state, x: undefined, y: undefined };
  const { x, y } = state;
  const visible = displays.some((d) => {
    const overlapX = Math.min(x + state.width, d.x + d.width) - Math.max(x, d.x);
    const overlapY = Math.min(y + state.height, d.y + d.height) - Math.max(y, d.y);
    return overlapX >= 120 && overlapY >= 80;
  });
  if (!visible) return { ...state, x: undefined, y: undefined };
  const largest = displays.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
  return { ...state, width: Math.min(state.width, Math.max(largest.width, MIN_SIZE.width)), height: Math.min(state.height, Math.max(largest.height, MIN_SIZE.height)) };
}
