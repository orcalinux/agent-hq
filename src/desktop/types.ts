import type { ViewMode } from '../types/mission';

export type DesktopCommand =
  | { type: 'navigate'; view: ViewMode }
  | { type: 'open-project'; path: string }
  | { type: 'command-palette' }
  | { type: 'toggle-theme' };

export interface DesktopStatus {
  /** Agents working right now. */
  busy: number;
  /** One line for the tray tooltip and menu. */
  label: string;
  /** A run is in progress; closing the window keeps it running in the tray. */
  running: boolean;
}

export interface DesktopApi {
  platform: string;
  version: string;
  setStatus: (status: DesktopStatus) => void;
  notify: (title: string, body: string) => void;
  /** Matches the native window buttons to the app theme. */
  setTheme: (mode: 'dark' | 'light') => void;
  /** Opens the application menu at a point in the window (Windows and Linux, where the title bar is custom). */
  showMenu: (x: number, y: number) => void;
  onCommand: (listener: (command: DesktopCommand) => void) => () => void;
}

export const TITLE_BAR_HEIGHT = 36;

declare global {
  interface Window {
    agentHqDesktop?: DesktopApi;
  }
}
