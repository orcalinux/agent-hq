import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { DesktopApi, DesktopCommand, DesktopStatus } from '../src/desktop/types';

const api: DesktopApi = {
  platform: process.platform,
  version: String(ipcRenderer.sendSync('desktop:version')),
  setStatus: (status: DesktopStatus) => ipcRenderer.send('desktop:status', status),
  notify: (title: string, body: string) => ipcRenderer.send('desktop:notify', { title: String(title), body: String(body) }),
  onCommand: (listener) => {
    const handler = (_event: IpcRendererEvent, command: DesktopCommand) => listener(command);
    ipcRenderer.on('desktop:command', handler);
    return () => ipcRenderer.removeListener('desktop:command', handler);
  },
};

contextBridge.exposeInMainWorld('agentHqDesktop', api);
