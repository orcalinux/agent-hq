import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { TrayApi, TrayState } from '../src/desktop/types';

const api: TrayApi = {
  getState: () => ipcRenderer.invoke('desktop:tray-state') as Promise<TrayState>,
  onState: (listener) => {
    const handler = (_event: IpcRendererEvent, state: TrayState) => listener(state);
    ipcRenderer.on('desktop:tray-state', handler);
    return () => ipcRenderer.removeListener('desktop:tray-state', handler);
  },
  action: (action) => ipcRenderer.send('desktop:tray-action', action),
};

contextBridge.exposeInMainWorld('agentHqTray', api);
