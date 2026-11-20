import path from 'path';
import { BrowserWindow, ipcMain, screen, type NativeImage, type Rectangle } from 'electron';
import type { TrayAction, TrayState } from '../src/desktop/types';
import { trayPanelBounds } from './trayPosition';

export function createTrayPanel(options: { url: string; icon: NativeImage; state: () => TrayState; action: (action: TrayAction) => void }) {
  let window: BrowserWindow | null = null;
  let loaded: Promise<void> | null = null;
  let wanted = false;
  let blurTimer: ReturnType<typeof setTimeout> | undefined;
  const url = new URL('tray.html', options.url.endsWith('/') ? options.url : options.url + '/').href;
  const fromPanel = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) =>
    event.sender === window?.webContents && event.senderFrame?.url === url;

  const hide = () => {
    wanted = false;
    clearTimeout(blurTimer);
    window?.hide();
  };
  const publish = () => {
    if (!window?.isDestroyed() && window?.isVisible()) window.webContents.send('desktop:tray-state', options.state());
  };
  const show = async (anchor?: Rectangle) => {
    wanted = true;
    clearTimeout(blurTimer);
    const pointer = screen.getCursorScreenPoint();
    const at = anchor && anchor.width > 0 && anchor.height > 0 ? anchor : { ...pointer, width: 0, height: 0 };
    const display = screen.getDisplayNearestPoint({ x: Math.round(at.x + at.width / 2), y: Math.round(at.y + at.height / 2) });
    const bounds = trayPanelBounds(at, display.workArea);
    if (!window || window.isDestroyed()) {
      window = new BrowserWindow({
        ...bounds,
        title: 'Agent HQ · Quick status',
        icon: options.icon,
        frame: false,
        show: false,
        resizable: false,
        maximizable: false,
        minimizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        backgroundColor: options.state().theme === 'light' ? '#f6f6f8' : '#131316',
        ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
        webPreferences: {
          preload: path.join(__dirname, 'tray-preload.cjs'),
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          webviewTag: false,
          spellcheck: false,
        },
      });
      window.setMenu(null);
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event, target) => {
        if (target !== url) event.preventDefault();
      });
      window.on('blur', () => {
        clearTimeout(blurTimer);
        blurTimer = setTimeout(hide, 120);
      });
      window.on('focus', () => clearTimeout(blurTimer));
      window.on('close', (event) => { event.preventDefault(); hide(); });
      window.on('closed', () => { window = null; loaded = null; wanted = false; });
      window.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'Escape') { event.preventDefault(); hide(); }
      });
      loaded = window.loadURL(url);
    }
    const panel = window;
    try {
      await loaded;
      if (!wanted || panel.isDestroyed()) return;
      panel.setBounds(bounds);
      panel.show();
      panel.focus();
      publish();
    } catch (error) {
      console.error('[Agent HQ] Quick status could not load:', error);
      hide();
      if (!panel.isDestroyed()) panel.destroy();
      options.action({ type: 'open' });
    }
  };

  ipcMain.handle('desktop:tray-state', (event) => fromPanel(event) ? options.state() : null);
  ipcMain.on('desktop:tray-action', (event, action: TrayAction) => {
    if (!fromPanel(event) || !action || typeof action !== 'object') return;
    if (action.type === 'hide') hide();
    else if (['open', 'updates', 'quit'].includes(action.type)) {
      hide();
      options.action(action);
    }
  });

  return {
    show,
    hide,
    publish,
    toggle: (anchor?: Rectangle) => wanted || window?.isVisible() ? hide() : void show(anchor),
    destroy: () => {
      clearTimeout(blurTimer);
      window?.destroy();
      ipcMain.removeHandler('desktop:tray-state');
      ipcMain.removeAllListeners('desktop:tray-action');
    },
  };
}
