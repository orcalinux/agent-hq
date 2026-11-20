import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { DesktopApi, DesktopCommand, DesktopStatus, UpdatePrefs, UpdateState } from '../src/desktop/types';

const api: DesktopApi = {
  platform: process.platform,
  version: String(ipcRenderer.sendSync('desktop:version')),
  setStatus: (status: DesktopStatus) => ipcRenderer.send('desktop:status', status),
  setTraySnapshot: (snapshot) => ipcRenderer.send('desktop:tray-snapshot', snapshot),
  showTrayPanel: () => ipcRenderer.send('desktop:tray-show'),
  notify: (title: string, body: string) => ipcRenderer.send('desktop:notify', { title: String(title), body: String(body) }),
  setTheme: (mode) => ipcRenderer.send('desktop:theme', mode === 'light' ? 'light' : 'dark'),
  showMenu: (x: number, y: number) => ipcRenderer.send('desktop:menu', { x: Math.round(Number(x) || 0), y: Math.round(Number(y) || 0) }),
  windowControl: (action) => ipcRenderer.send('desktop:window', action),
  isMaximized: () => ipcRenderer.invoke('desktop:is-maximized') as Promise<boolean>,
  onMaximized: (listener) => {
    const handler = (_event: IpcRendererEvent, maximized: boolean) => listener(Boolean(maximized));
    ipcRenderer.on('desktop:maximized', handler);
    return () => ipcRenderer.removeListener('desktop:maximized', handler);
  },
  onCommand: (listener) => {
    const handler = (_event: IpcRendererEvent, command: DesktopCommand) => listener(command);
    ipcRenderer.on('desktop:command', handler);
    return () => ipcRenderer.removeListener('desktop:command', handler);
  },
  getUpdateState: () => ipcRenderer.invoke('desktop:update-state') as Promise<UpdateState>,
  onUpdate: (listener) => {
    const handler = (_event: IpcRendererEvent, state: UpdateState) => listener(state);
    ipcRenderer.on('desktop:update', handler);
    return () => ipcRenderer.removeListener('desktop:update', handler);
  },
  checkForUpdates: () => ipcRenderer.send('desktop:update-check'),
  downloadUpdate: () => ipcRenderer.send('desktop:update-download'),
  installUpdate: (when) => ipcRenderer.send('desktop:update-install', when === 'idle' ? 'idle' : 'now'),
  getUpdatePrefs: () => ipcRenderer.invoke('desktop:update-prefs') as Promise<UpdatePrefs>,
  setUpdatePrefs: (prefs) => ipcRenderer.invoke('desktop:update-prefs-set', prefs) as Promise<UpdatePrefs>,
  getChangelog: (version) => ipcRenderer.invoke('desktop:changelog', typeof version === 'string' ? version : '') as Promise<string | null>,
  ackUpdated: () => ipcRenderer.send('desktop:update-ack'),
};

contextBridge.exposeInMainWorld('agentHqDesktop', api);
