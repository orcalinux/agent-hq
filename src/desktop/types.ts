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
  onCommand: (listener: (command: DesktopCommand) => void) => () => void;
}

declare global {
  interface Window {
    agentHqDesktop?: DesktopApi;
  }
}
