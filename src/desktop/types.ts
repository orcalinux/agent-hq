import type { ViewMode } from '../types/mission';
import type { AgentStatus } from '../types/agent';

export type DesktopCommand =
  | { type: 'navigate'; view: ViewMode }
  | { type: 'open-project'; path: string }
  | { type: 'command-palette' }
  | { type: 'toggle-theme' }
  | { type: 'open-terminal' }
  | { type: 'show-agent'; agentId: string }
  | { type: 'check-updates' }
  | { type: 'show-about' }
  | { type: 'show-updates' };

export type TrayAction =
  | { type: 'open'; view?: ViewMode; agentId?: string }
  | { type: 'updates' }
  | { type: 'hide' }
  | { type: 'quit' };

export interface TraySnapshot extends DesktopStatus {
  theme: 'dark' | 'light';
  project: string;
  projectPath: string;
  totalAgents: number;
  connectedProviders: number;
  totalProviders: number;
  mission: { title: string; completed: number; total: number; failed: number; review: number; source: 'live' | 'simulation' } | null;
  usage: { calls: number; totalTokens: number; estimatedCostUSD: number; unpricedTokens: number };
  /** What the team has learned on this project; missing until the project's memory is read. */
  learning?: { lessons: number; thisWeek: number; top?: { name: string; level: string } };
  agents: Array<{ id: string; name: string; title: string; avatar: string; status: AgentStatus; model: string; task?: string }>;
  activity: Array<{ id: string; text: string; timestamp: number; level: 'info' | 'success' | 'warn' | 'error'; agent?: string }>;
}

export interface TrayState extends TraySnapshot {
  current: string;
  update: UpdateState;
}

export interface TrayApi {
  getState: () => Promise<TrayState>;
  onState: (listener: (state: TrayState) => void) => () => void;
  action: (action: TrayAction) => void;
}

export interface DesktopStatus {
  /** Agents working right now. */
  busy: number;
  /** One line for the tray tooltip and menu. */
  label: string;
  /** A run is in progress; closing the window keeps it running in the tray. */
  running: boolean;
}

export type UpdateStatus =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'error';

export interface UpdateState {
  status: UpdateStatus;
  /** The version running now. */
  current: string;
  /** The newer version found, downloading or ready to install. */
  version?: string;
  /** Download progress, 0 to 100. */
  percent?: number;
  /** Download size in bytes, when known. */
  size?: number;
  error?: string;
  /** When the last check finished, in ms since the epoch. */
  checkedAt?: number;
  /** Ready, and restarting by itself once no agent is working. */
  waiting?: boolean;
  /** The version this one replaced, on the first launch after an update. */
  updatedFrom?: string;
  /** The package is being installed (an administrator prompt may be showing). */
  installing?: boolean;
  /** Why the last install did not happen, and the command to run by hand. */
  installFailure?: { message: string; command: string; file: string };
  /** Plays the flow without a release (AGENT_HQ_SIMULATE_UPDATE). */
  simulated?: boolean;
}

export interface UpdatePrefs {
  /** Check for a newer version by itself. */
  auto: boolean;
  /** Hours between checks. */
  everyHours: 1 | 6 | 12 | 24;
  /** Download a newer version as soon as it is found. */
  autoDownload: boolean;
  /** Restart into a downloaded update once no agent is working. */
  autoRestart: boolean;
  /** Show the Update button in the title bar. */
  showButton: boolean;
  /** The button hidden until then (ms since the epoch), for this version only. */
  hiddenUntil?: number;
  hiddenVersion?: string;
}

export const DEFAULT_UPDATE_PREFS: UpdatePrefs = { auto: true, everyHours: 6, autoDownload: true, autoRestart: false, showButton: true };

export interface DesktopMenuItem {
  id: string;
  label: string;
  enabled: boolean;
  separator?: boolean;
  checked?: boolean;
  shortcut?: string;
  children?: DesktopMenuItem[];
}

export interface DesktopApi {
  platform: string;
  version: string;
  setStatus: (status: DesktopStatus) => void;
  setTraySnapshot: (snapshot: TraySnapshot) => void;
  showTrayPanel: () => void;
  notify: (title: string, body: string) => void;
  /** Matches the native window buttons to the app theme. */
  setTheme: (mode: 'dark' | 'light') => void;
  /** Opens the application menu at a point in the window (Windows and Linux, where the title bar is custom). */
  showMenu: (x: number, y: number) => void;
  getMenu: () => Promise<DesktopMenuItem[]>;
  runMenuItem: (id: string) => void;
  /** Minimize, maximize/restore or close the window (Linux, where the app draws its own window buttons). */
  windowControl: (action: 'minimize' | 'toggle-maximize' | 'close') => void;
  isMaximized: () => Promise<boolean>;
  onMaximized: (listener: (maximized: boolean) => void) => () => void;
  onCommand: (listener: (command: DesktopCommand) => void) => () => void;
  getUpdateState: () => Promise<UpdateState>;
  onUpdate: (listener: (state: UpdateState) => void) => () => void;
  checkForUpdates: () => void;
  /** Downloads a found update (when automatic download is off). */
  downloadUpdate: () => void;
  /** Quits, installs the downloaded update and starts the new version. `later` restarts once no agent is working. */
  installUpdate: (when?: 'now' | 'idle') => void;
  installUpdateInTerminal: () => void;
  getUpdatePrefs: () => Promise<UpdatePrefs>;
  setUpdatePrefs: (prefs: Partial<UpdatePrefs>) => Promise<UpdatePrefs>;
  /** CHANGELOG.md of a version: the installed one, or a newer one from GitHub. */
  getChangelog: (version?: string) => Promise<string | null>;
  /** First launch after an update has shown its notes. */
  ackUpdated: () => void;
}

export const TITLE_BAR_HEIGHT = 36;

declare global {
  interface Window {
    agentHqDesktop?: DesktopApi;
    agentHqTray?: TrayApi;
  }
}
