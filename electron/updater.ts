import fs from 'fs';
import path from 'path';
import { app, net } from 'electron';
import { DEFAULT_UPDATE_PREFS, type UpdatePrefs, type UpdateState } from '../src/desktop/types';
import { compareVersions } from '../src/desktop/changelog';
import { manualCommand, packageKind, runPackageInstall, runTerminalPackageInstall } from './packageInstall';

const REPO_RAW = 'https://raw.githubusercontent.com/orcalinux/agent-hq';
const FIRST_CHECK_MS = 10_000;
const HOURS = [1, 6, 12, 24] as const;
const VERSION = /^\d+\.\d+\.\d+$/;

export interface UpdaterOptions {
  /** Called on every state change, to forward it to the window. */
  onState: (state: UpdateState) => void;
  /** Called once per downloaded version, for a system notification. */
  onReady: (version: string) => void;
  /** Whether agents are working, so a restart would cut a run short. */
  busy: () => boolean;
  /** Called right before the app quits to install, so the window may close. */
  beforeInstall: () => void;
}

export interface Updater {
  state: () => UpdateState;
  prefs: () => UpdatePrefs;
  setPrefs: (next: Partial<UpdatePrefs>) => UpdatePrefs;
  check: () => Promise<UpdateState>;
  download: () => void;
  /** 'now' quits and installs; 'idle' waits until no agent is working. */
  install: (when: 'now' | 'idle') => void;
  installInTerminal: () => void;
  /** Tells the updater that agents stopped working, for a restart that waits. */
  idle: () => void;
  changelog: (version?: string) => Promise<string | null>;
  ackUpdated: () => void;
  start: () => void;
  stop: () => void;
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeFile(file: string, text: string): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  } catch {
    /* settings are best effort */
  }
}

export function cleanPrefs(raw: Partial<UpdatePrefs> | null | undefined, base: UpdatePrefs = DEFAULT_UPDATE_PREFS): UpdatePrefs {
  const p = { ...base, ...(raw ?? {}) };
  return {
    auto: p.auto !== false,
    everyHours: (HOURS as readonly number[]).includes(Number(p.everyHours)) ? (Number(p.everyHours) as UpdatePrefs['everyHours']) : base.everyHours,
    autoDownload: p.autoDownload !== false,
    autoRestart: p.autoRestart === true,
    showButton: p.showButton !== false,
    hiddenUntil: Number.isFinite(Number(p.hiddenUntil)) && Number(p.hiddenUntil) > 0 ? Number(p.hiddenUntil) : undefined,
    hiddenVersion: typeof p.hiddenVersion === 'string' && VERSION.test(p.hiddenVersion) ? p.hiddenVersion : undefined,
  };
}

/**
 * Background updates from GitHub Releases, in the order Magpie made familiar: found, downloaded
 * in the background, then a restart the user chooses (or one that waits until no agent is
 * working). AGENT_HQ_SIMULATE_UPDATE=<version> plays the whole flow without a release.
 */
export function createUpdater({ onState, onReady, busy, beforeInstall }: UpdaterOptions): Updater {
  const simulated = process.env.AGENT_HQ_SIMULATE_UPDATE?.trim();
  const supported = (Boolean(simulated) && VERSION.test(simulated!)) || (app.isPackaged && !process.env.AGENT_HQ_NO_UPDATES);
  const prefsFile = () => path.join(app.getPath('userData'), 'update-prefs.json');
  const lastFile = () => path.join(app.getPath('userData'), 'last-version');
  let prefs = cleanPrefs(readJson<Partial<UpdatePrefs>>(prefsFile()));

  let updatedFrom: string | undefined;
  try {
    const last = fs.readFileSync(lastFile(), 'utf8').trim();
    if (VERSION.test(last) && compareVersions(last, app.getVersion()) < 0) updatedFrom = last;
  } catch {
    /* first launch */
  }
  if (!updatedFrom) writeFile(lastFile(), app.getVersion());

  let current: UpdateState = { status: supported ? 'idle' : 'unsupported', current: app.getVersion(), updatedFrom, simulated: Boolean(simulated) || undefined };
  let announced = '';
  let timers: NodeJS.Timeout[] = [];
  let running: Promise<UpdateState> | null = null;
  let simDownload: Promise<void> | null = null;
  let downloadedFile: string | undefined;

  const set = (next: Partial<UpdateState> & { status: UpdateState['status'] }, keep = false) => {
    current = { ...(keep ? current : {}), ...next, current: app.getVersion(), updatedFrom, simulated: Boolean(simulated) || undefined };
    onState(current);
    if (current.status === 'ready' && current.version && current.version !== announced) {
      announced = current.version;
      onReady(current.version);
      if (prefs.autoRestart) install('idle');
    }
  };
  const inFlight = () => current.status === 'downloading' || current.status === 'ready';

  // ---- simulation: every step of a real update, with nothing installed ----
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const simGet = async () => {
    if (simDownload) return simDownload;
    simDownload = (async () => {
      const version = simulated!;
      for (let percent = 0; percent <= 100; percent += 5) {
        set({ status: 'downloading', version, percent, size: 98_400_000, checkedAt: current.checkedAt });
        await wait(120);
      }
      set({ status: 'ready', version, size: 98_400_000, checkedAt: Date.now() });
    })().finally(() => (simDownload = null));
    return simDownload;
  };
  const simulate = async (): Promise<UpdateState> => {
    set({ status: 'checking' });
    await wait(500);
    if (compareVersions(simulated!, app.getVersion()) <= 0) {
      set({ status: 'up-to-date', checkedAt: Date.now() });
      return current;
    }
    if (!prefs.autoDownload) {
      set({ status: 'available', version: simulated, size: 98_400_000, checkedAt: Date.now() });
      return current;
    }
    await simGet();
    return current;
  };

  // ---- electron-updater against GitHub Releases ----
  type AutoUpdater = (typeof import('electron-updater'))['autoUpdater'];
  let wired: AutoUpdater | null = null;
  const updater = async (): Promise<AutoUpdater> => {
    if (wired) return wired;
    const { default: updaterModule } = await import('electron-updater');
    const { autoUpdater } = updaterModule;
    autoUpdater.autoDownload = prefs.autoDownload;
    autoUpdater.autoInstallOnAppQuit = !ownsInstall();
    autoUpdater.on('checking-for-update', () => set({ status: 'checking' }));
    autoUpdater.on('update-not-available', () => set({ status: 'up-to-date', checkedAt: Date.now() }));
    autoUpdater.on('update-available', (info) => {
      const size = info.files?.reduce((n, f) => Math.max(n, f.size ?? 0), 0) || undefined;
      set({ status: autoUpdater.autoDownload ? 'downloading' : 'available', version: info.version, percent: 0, size, checkedAt: Date.now() });
    });
    autoUpdater.on('download-progress', (p) => set({ status: 'downloading', percent: Math.floor(p.percent), size: p.total || current.size }, true));
    autoUpdater.on('update-downloaded', (info) => {
      downloadedFile = info.downloadedFile;
      set({ status: 'ready', version: info.version, size: current.size, checkedAt: Date.now() });
    });
    autoUpdater.on('error', (err) => {
      if (current.status === 'ready') return;
      set({ status: 'error', version: current.version, error: err?.message ?? String(err), checkedAt: Date.now() });
    });
    wired = autoUpdater;
    return autoUpdater;
  };
  const real = async (): Promise<UpdateState> => {
    try {
      await (await updater()).checkForUpdates();
    } catch (err) {
      set({ status: 'error', version: current.version, error: (err as Error).message, checkedAt: Date.now() });
    }
    return current;
  };

  const check = async (): Promise<UpdateState> => {
    if (!supported || inFlight()) return current;
    if (!running) running = (simulated ? simulate() : real()).finally(() => (running = null));
    return running;
  };

  const ownsInstall = () => process.platform === 'linux' && !process.env.APPIMAGE && !simulated;

  let installing = false;
  const installPackage = async (file: string, terminal = false) => {
    if (installing) return;
    installing = true;
    set({ ...current, installing: true, waiting: false, installFailure: undefined });
    const result = await Promise.resolve().then(() => terminal ? runTerminalPackageInstall(file) : runPackageInstall(file)).catch((error: Error) => ({
      ok: false as const, message: `Could not start installation: ${error.message}`,
      command: manualCommand(packageKind(file) ?? 'deb', file), file,
    }));
    installing = false;
    if (result.ok) {
      beforeInstall();
      app.relaunch();
      app.quit();
      return;
    }
    set({ ...current, installing: false, installFailure: { message: result.message, command: result.command, file: result.file } });
  };

  const quitAndInstall = () => {
    if (current.status !== 'ready') return;
    if (simulated) {
      if (process.env.AGENT_HQ_SIMULATE_INSTALL_FAILURE) {
        set({ ...current, installFailure: { message: 'The administrator prompt was cancelled, so nothing was installed.', command: "sudo dpkg -i '/tmp/agent-hq.deb'", file: '/tmp/agent-hq.deb' } });
        return;
      }
      set({ status: 'up-to-date', checkedAt: Date.now() });
      return;
    }
    if (ownsInstall() && downloadedFile && packageKind(downloadedFile)) {
      void installPackage(downloadedFile);
      return;
    }
    beforeInstall();
    void updater().then((u) => u.quitAndInstall(false, true));
  };

  function install(when: 'now' | 'idle'): void {
    if (current.status !== 'ready') return;
    if (when === 'idle' && busy()) {
      if (!current.waiting) set({ ...current, waiting: true });
      return;
    }
    quitAndInstall();
  }

  const schedule = () => {
    timers.forEach((t) => clearTimeout(t));
    timers = [];
    if (!supported || !prefs.auto) return;
    timers.push(setTimeout(() => void check(), simulated ? 1500 : FIRST_CHECK_MS));
    timers.push(setInterval(() => void check(), prefs.everyHours * 60 * 60 * 1000));
  };

  return {
    state: () => current,
    prefs: () => prefs,
    setPrefs: (next) => {
      const before = prefs;
      prefs = cleanPrefs(next, prefs);
      writeFile(prefsFile(), JSON.stringify(prefs, null, 2));
      if (wired) wired.autoDownload = prefs.autoDownload;
      if (before.auto !== prefs.auto || before.everyHours !== prefs.everyHours) schedule();
      if (!before.autoRestart && prefs.autoRestart && current.status === 'ready') install('idle');
      if (before.autoRestart && !prefs.autoRestart && current.waiting) set({ ...current, waiting: false });
      return prefs;
    },
    check,
    download: () => {
      if (current.status !== 'available' && current.status !== 'error') return;
      if (simulated) void simGet();
      else void updater().then((u) => {
        set({ status: 'downloading', version: current.version, percent: 0, size: current.size, checkedAt: current.checkedAt });
        return u.downloadUpdate();
      }).catch((err: Error) => set({ status: 'error', version: current.version, error: err.message, checkedAt: Date.now() }));
    },
    install,
    installInTerminal: () => {
      if (current.status !== 'ready' || !current.installFailure || installing || !ownsInstall() || !downloadedFile || !packageKind(downloadedFile)) return;
      void installPackage(downloadedFile, true);
    },
    idle: () => {
      if (current.waiting && !busy()) quitAndInstall();
    },
    changelog: async (version) => {
      const bundled = path.join(__dirname, 'CHANGELOG.md');
      const local = () => {
        try {
          return fs.readFileSync(bundled, 'utf8');
        } catch {
          return null;
        }
      };
      if (!version || version === app.getVersion() || simulated) return local();
      if (!VERSION.test(version)) return null;
      try {
        const res = await net.fetch(`${REPO_RAW}/v${version}/CHANGELOG.md`, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) return null;
        const text = await res.text();
        return text.length > 512_000 ? text.slice(0, 512_000) : text;
      } catch {
        return null;
      }
    },
    ackUpdated: () => {
      if (!updatedFrom) return;
      updatedFrom = undefined;
      writeFile(lastFile(), app.getVersion());
      set({ ...current });
    },
    start: schedule,
    stop: () => {
      timers.forEach((t) => clearTimeout(t));
      timers = [];
    },
  };
}
