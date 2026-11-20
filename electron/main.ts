import fs from 'fs';
import path from 'path';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  screen,
  session,
  shell,
  Tray,
  type MenuItemConstructorOptions,
} from 'electron';
import { TITLE_BAR_HEIGHT, type DesktopCommand, type DesktopStatus, type UpdatePrefs, type TraySnapshot, type TrayState } from '../src/desktop/types';
import { startStandaloneServer, type StandaloneServer } from '../server/standalone';
import { deepLinkFromArgv, parseDeepLink, PROTOCOL } from './deepLink';
import { fitToDisplays, loadWindowState, MIN_SIZE, saveWindowState } from './windowState';
import { createUpdater } from './updater';
import { createTrayPanel } from './trayPanel';

const PRODUCT = 'Agent HQ';
const REPO_URL = 'https://github.com/orcalinux/agent-hq';
/** A fixed port keeps the page origin, and so the saved UI state, the same between launches. */
const PREFERRED_PORTS = [47821, 47822, 47823, 0];
const TITLE_BAR = {
  dark: { color: '#18181b', symbolColor: '#a6a6b0' },
  light: { color: '#ffffff', symbolColor: '#52525c' },
};

if (process.env.AGENT_HQ_USER_DATA) app.setPath('userData', path.resolve(process.env.AGENT_HQ_USER_DATA));
app.setName(PRODUCT);
if (process.platform === 'win32') app.setAppUserModelId('io.github.orcalinux.agenthq');

const assets = path.join(__dirname, 'assets');
const appIcon = () => nativeImage.createFromPath(path.join(assets, 'icon.png'));
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

let mainWindow: BrowserWindow | null = null;
let server: StandaloneServer | null = null;
let appUrl = '';
let tray: Tray | null = null;
let quickPanel: ReturnType<typeof createTrayPanel> | null = null;
let traySnapshot: TraySnapshot = {
  busy: 0, label: 'Idle', running: false, theme: 'dark', project: '', projectPath: '',
  totalAgents: 0, connectedProviders: 0, totalProviders: 0, mission: null,
  usage: { calls: 0, totalTokens: 0, estimatedCostUSD: 0, unpricedTokens: 0 },
  agents: [], activity: [],
};
let status: DesktopStatus = { busy: 0, label: 'Idle', running: false };
let quitting = false;
let toldAboutTray = false;
let theme: 'dark' | 'light' = 'dark';
const CANVAS = { dark: '#131316', light: '#f6f6f8' };
let pendingLink: string | undefined = deepLinkFromArgv(process.argv);
const updater = createUpdater({
  onState: (state) => {
    mainWindow?.webContents.send('desktop:update', state);
    updateTray();
    quickPanel?.publish();
  },
  onReady: (version) => {
    if (!Notification.isSupported()) return;
    const notification = new Notification({
      title: `${PRODUCT} ${version} is ready`,
      body: 'Restart to update. Your projects and settings are kept.',
      icon: appIcon(),
    });
    notification.on('click', () => showWindow());
    notification.show();
  },
  busy: () => status.running,
  beforeInstall: () => {
    quitting = true;
  },
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    showWindow();
    const link = deepLinkFromArgv(argv);
    if (link) void handleDeepLink(link);
  });
  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (mainWindow) void handleDeepLink(url);
    else pendingLink = url;
  });
  void app.whenReady().then(start);
}

function registerProtocol(): void {
  if (process.defaultApp) {
    if (process.argv.length >= 2) app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL);
  }
}

function send(command: DesktopCommand): void {
  mainWindow?.webContents.send('desktop:command', command);
}

function showWindow(): void {
  if (!mainWindow) return;
  quickPanel?.hide();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function handleDeepLink(raw: string): Promise<void> {
  const link = parseDeepLink(raw);
  if (!link || !mainWindow) return;
  showWindow();
  if (link.type === 'navigate') {
    send(link);
    return;
  }
  let isDir = false;
  try {
    isDir = fs.statSync(link.path).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) {
    await dialog.showMessageBox(mainWindow, { type: 'warning', message: 'This project folder does not exist.', detail: link.path });
    return;
  }
  const answer = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Open project', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    message: 'Open this folder as the project?',
    detail: `${link.path}\n\nA link asked ${PRODUCT} to open it. Agents only work on it after you approve a plan.`,
  });
  if (answer.response === 0) send(link);
}

async function pickProject(): Promise<void> {
  if (!mainWindow) return;
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Open project folder', properties: ['openDirectory', 'createDirectory'] });
  if (!result.canceled && result.filePaths[0]) send({ type: 'open-project', path: result.filePaths[0] });
}

/** The menu command: the title bar and Settings show progress, so only outcomes with nothing to show get a dialog. */
async function checkForUpdatesFromMenu(): Promise<void> {
  const state = await updater.check();
  if (!mainWindow) return;
  if (state.status === 'unsupported') await dialog.showMessageBox(mainWindow, { message: 'Updates are only checked in installed builds.' });
  else if (state.status === 'up-to-date') await dialog.showMessageBox(mainWindow, { message: `${PRODUCT} ${app.getVersion()} is up to date.` });
  else if (state.status === 'error') await dialog.showMessageBox(mainWindow, { type: 'warning', message: 'Could not check for updates.', detail: state.error });
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const go = (view: Extract<DesktopCommand, { type: 'navigate' }>['view']) => () => {
    showWindow();
    send({ type: 'navigate', view });
  };
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: () => void pickProject() },
        { type: 'separator' },
        { label: 'Connections', click: go('connections') },
        { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: go('settings') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { label: 'Quit', accelerator: 'Ctrl+Q', click: () => quit() },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Workspace', accelerator: 'Alt+1', registerAccelerator: false, click: go('workspace') },
        { label: 'Agents', accelerator: 'Alt+2', registerAccelerator: false, click: go('agents') },
        { label: 'Tasks', accelerator: 'Alt+3', registerAccelerator: false, click: go('tasks') },
        { label: 'Reports', accelerator: 'Alt+4', registerAccelerator: false, click: go('reports') },
        { label: 'Growth', accelerator: 'Alt+6', registerAccelerator: false, click: go('growth') },
        { type: 'separator' },
        { label: 'Command Palette', accelerator: 'CmdOrCtrl+K', registerAccelerator: false, click: () => send({ type: 'command-palette' }) },
        { label: 'Switch Theme (System, Light, Dark)', click: () => send({ type: 'toggle-theme' }) },
        { label: 'Open Integrated Terminal', accelerator: 'CmdOrCtrl+`', registerAccelerator: false, click: () => send({ type: 'open-terminal' }) },
        { label: 'Quick status', accelerator: 'CmdOrCtrl+Shift+Space', click: () => void quickPanel?.show() },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Documentation', click: () => void shell.openExternal(`${REPO_URL}#readme`) },
        { label: 'Report an Issue', click: () => void shell.openExternal(`${REPO_URL}/issues/new`) },
        { label: 'Releases', click: () => void shell.openExternal(`${REPO_URL}/releases`) },
        { type: 'separator' },
        { label: 'Check for Updates…', click: () => void checkForUpdatesFromMenu() },
        { label: 'Show Settings Folder', click: () => void shell.openPath(app.getPath('userData')) },
        ...(isMac ? [] : [{ type: 'separator' as const }, { label: `About ${PRODUCT}`, click: () => app.showAboutPanel() }]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  app.setAboutPanelOptions({
    applicationName: PRODUCT,
    applicationVersion: app.getVersion(),
    copyright: 'A local command center for teams of AI coding agents.',
    website: REPO_URL,
    iconPath: path.join(assets, 'icon.png'),
  });
}

function updateTray(): void {
  if (!tray) return;
  tray.setToolTip(`${PRODUCT}${traySnapshot.project ? ' · ' + traySnapshot.project : ''} · ${status.label}`);
  const go = (view: Extract<DesktopCommand, { type: 'navigate' }>['view']) => () => {
    showWindow();
    send({ type: 'navigate', view });
  };
  const update = updater.state();
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: status.label, enabled: false },
      { label: 'Quick status', click: () => void quickPanel?.show() },
      { type: 'separator' },
      ...(update.status === 'ready'
        ? [{ label: `Restart to update to ${update.version}`, click: () => updater.install('now') }, { type: 'separator' as const }]
        : []),
      { label: `Show ${PRODUCT}`, click: () => showWindow() },
      { label: 'Workspace', click: go('workspace') },
      { label: 'Agents', click: go('agents') },
      { label: 'Tasks', click: go('tasks') },
      { type: 'separator' },
      { label: 'Quit', click: () => quit() },
    ])
  );
}

function createTray(): void {
  try {
    const icon = nativeImage.createFromPath(path.join(assets, process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'));
    if (process.platform === 'darwin') icon.setTemplateImage(true);
    tray = new Tray(icon);
    tray.on('click', (_event, bounds) => quickPanel?.toggle(bounds));
    updateTray();
  } catch {
    tray = null;
  }
}

function quit(): void {
  quitting = true;
  app.quit();
}

function isAppOrigin(url: string): boolean {
  try {
    return new URL(url).origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}

function openExternal(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'mailto:') void shell.openExternal(parsed.toString());
  } catch {
    // ignore malformed links
  }
}

function createWindow(): BrowserWindow {
  const saved = fitToDisplays(loadWindowState(stateFile()), screen.getAllDisplays().map((d) => d.workArea));
  theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  const win = new BrowserWindow({
    ...(saved.x !== undefined && saved.y !== undefined ? { x: saved.x, y: saved.y } : {}),
    width: saved.width,
    height: saved.height,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    title: PRODUCT,
    icon: appIcon(),
    show: false,
    backgroundColor: CANVAS[theme],
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 14, y: Math.round((TITLE_BAR_HEIGHT - 14) / 2) } }
      : process.platform === 'win32'
        ? { titleBarOverlay: { ...TITLE_BAR[theme], height: TITLE_BAR_HEIGHT } }
        : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
    },
  });
  if (saved.maximized) win.maximize();

  win.once('ready-to-show', () => {
    if (!process.env.AGENT_HQ_HIDDEN) win.show();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (isAppOrigin(url)) return;
    event.preventDefault();
    openExternal(url);
  });

  const remember = () => {
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    const maximized = win.isMaximized();
    const bounds = maximized ? loadWindowState(stateFile()) : win.getBounds();
    saveWindowState(stateFile(), { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, maximized });
  };
  let timer: NodeJS.Timeout | undefined;
  const rememberSoon = () => {
    clearTimeout(timer);
    timer = setTimeout(remember, 400);
  };
  win.on('resize', rememberSoon);
  win.on('move', rememberSoon);
  const tellMaximized = () => {
    if (!win.isDestroyed()) win.webContents.send('desktop:maximized', win.isMaximized());
  };
  win.on('maximize', () => { remember(); tellMaximized(); });
  win.on('unmaximize', () => { remember(); tellMaximized(); });

  win.on('close', (event) => {
    remember();
    if (quitting || !tray) return;
    event.preventDefault();
    win.hide();
    if (!toldAboutTray) {
      toldAboutTray = true;
      new Notification({
        title: `${PRODUCT} is still running`,
        body: status.running ? 'The run continues in the background. Click the tray icon for quick status.' : 'Click the tray icon for quick status, or choose Quit to exit.',
        icon: appIcon(),
      }).show();
    }
  });
  win.on('closed', () => {
    mainWindow = null;
  });
  return win;
}

function registerIpc(): void {
  const fromApp = (event: Electron.IpcMainEvent) => event.sender === mainWindow?.webContents && isAppOrigin(event.senderFrame?.url ?? '');
  ipcMain.on('desktop:version', (event) => {
    event.returnValue = app.getVersion();
  });
  ipcMain.on('desktop:status', (event, next: DesktopStatus) => {
    if (!fromApp(event) || typeof next !== 'object' || !next) return;
    status = {
      busy: Math.max(0, Math.min(999, Number(next.busy) || 0)),
      label: String(next.label ?? '').slice(0, 120) || 'Idle',
      running: next.running === true,
    };
    updateTray();
    quickPanel?.publish();
    if (process.platform === 'darwin' || process.platform === 'linux') app.setBadgeCount(status.busy);
    mainWindow?.setProgressBar(status.running ? 2 : -1);
    if (!status.running) updater.idle();
  });
  ipcMain.on('desktop:tray-snapshot', (event, next: TraySnapshot) => {
    if (!fromApp(event) || !next || typeof next !== 'object' || !Array.isArray(next.agents) || !Array.isArray(next.activity) || !next.usage) return;
    const changedProject = next.project !== traySnapshot.project;
    traySnapshot = next;
    if (changedProject) updateTray();
    quickPanel?.publish();
  });
  ipcMain.on('desktop:tray-show', (event) => {
    if (fromApp(event)) void quickPanel?.show();
  });
  ipcMain.on('desktop:notify', (event, payload: { title?: unknown; body?: unknown }) => {
    if (!fromApp(event) || !Notification.isSupported()) return;
    const notification = new Notification({
      title: String(payload?.title ?? PRODUCT).slice(0, 120),
      body: String(payload?.body ?? '').slice(0, 400),
      icon: appIcon(),
    });
    notification.on('click', () => showWindow());
    notification.show();
  });
  ipcMain.on('desktop:theme', (event, mode: unknown) => {
    if (!fromApp(event) || (mode !== 'dark' && mode !== 'light')) return;
    theme = mode;
    if (process.platform === 'win32') mainWindow?.setTitleBarOverlay({ ...TITLE_BAR[theme], height: TITLE_BAR_HEIGHT });
    mainWindow?.setBackgroundColor(CANVAS[theme]);
    quickPanel?.publish();
  });
  ipcMain.on('desktop:window', (event, action: unknown) => {
    if (!fromApp(event) || !mainWindow) return;
    if (action === 'minimize') mainWindow.minimize();
    else if (action === 'close') mainWindow.close();
    else if (action === 'toggle-maximize') mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  });
  ipcMain.handle('desktop:is-maximized', (event) => event.sender === mainWindow?.webContents && Boolean(mainWindow?.isMaximized()));
  ipcMain.on('desktop:menu', (event, at: { x?: unknown; y?: unknown }) => {
    if (!fromApp(event) || !mainWindow) return;
    Menu.getApplicationMenu()?.popup({ window: mainWindow, x: Number(at?.x) || 0, y: Number(at?.y) || TITLE_BAR_HEIGHT });
  });
  const fromAppInvoke = (event: Electron.IpcMainInvokeEvent) => event.sender === mainWindow?.webContents && isAppOrigin(event.senderFrame?.url ?? '');
  ipcMain.handle('desktop:update-state', (event) => (fromAppInvoke(event) ? updater.state() : null));
  ipcMain.handle('desktop:update-prefs', (event) => (fromAppInvoke(event) ? updater.prefs() : null));
  ipcMain.handle('desktop:update-prefs-set', (event, next: unknown) =>
    fromAppInvoke(event) && next && typeof next === 'object' ? updater.setPrefs(next as Partial<UpdatePrefs>) : updater.prefs()
  );
  ipcMain.handle('desktop:changelog', (event, version: unknown) => (fromAppInvoke(event) ? updater.changelog(typeof version === 'string' ? version : '') : null));
  ipcMain.on('desktop:update-check', (event) => {
    if (fromApp(event)) void updater.check();
  });
  ipcMain.on('desktop:update-download', (event) => {
    if (fromApp(event)) updater.download();
  });
  ipcMain.on('desktop:update-install', (event, when: unknown) => {
    if (fromApp(event)) updater.install(when === 'idle' ? 'idle' : 'now');
  });
  ipcMain.on('desktop:update-ack', (event) => {
    if (fromApp(event)) updater.ackUpdated();
  });
}

function lockDownSession(): void {
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(isAppOrigin(wc.getURL()) && (permission === 'notifications' || permission === 'clipboard-sanitized-write'));
  });
}

async function start(): Promise<void> {
  process.env.AGENT_HQ_FALLBACK_WORKSPACE ||= path.join(app.getPath('documents'), PRODUCT);
  registerProtocol();
  lockDownSession();
  registerIpc();
  buildMenu();

  const devUrl = process.env.AGENT_HQ_DEV_URL;
  if (devUrl) {
    appUrl = devUrl;
  } else {
    try {
      server = await startStandaloneServer({ staticDir: path.join(app.getAppPath(), 'dist'), ports: PREFERRED_PORTS });
      appUrl = server.url;
    } catch (err) {
      dialog.showErrorBox(`${PRODUCT} could not start`, (err as Error).message);
      app.exit(1);
      return;
    }
  }

  mainWindow = createWindow();
  quickPanel = createTrayPanel({
    url: appUrl,
    icon: appIcon(),
    state: (): TrayState => ({ ...traySnapshot, ...status, theme, current: app.getVersion(), update: updater.state() }),
    action: (action) => {
      if (action.type === 'quit') return quit();
      showWindow();
      if (action.type === 'updates') send({ type: 'show-updates' });
      else if (action.type === 'open') {
        const views = ['workspace', 'agents', 'tasks', 'reports', 'growth', 'connections', 'settings'];
        if (typeof action.agentId === 'string') send({ type: 'show-agent', agentId: action.agentId });
        else if (action.view && views.includes(action.view)) send({ type: 'navigate', view: action.view });
      }
    },
  });
  createTray();
  await mainWindow.loadURL(appUrl);
  if (pendingLink) {
    const link = pendingLink;
    pendingLink = undefined;
    void handleDeepLink(link);
  }
  updater.start();

  app.on('activate', () => {
    if (mainWindow) showWindow();
    else {
      mainWindow = createWindow();
      void mainWindow.loadURL(appUrl);
    }
  });
}

app.on('before-quit', () => {
  quitting = true;
  quickPanel?.destroy();
  quickPanel = null;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  void server?.close();
});
