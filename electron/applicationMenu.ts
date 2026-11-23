import { app, Menu, type BrowserWindow, type MenuItem } from 'electron';
import type { DesktopMenuItem } from '../src/desktop/types';

export function menuSnapshot(menu: Menu | null = Menu.getApplicationMenu(), parent = ''): DesktopMenuItem[] {
  return menu?.items.flatMap((item, index) => {
    if (!item.visible) return [];
    const id = parent ? `${parent}.${index}` : String(index);
    return [{
      id,
      label: item.label.replace(/&&/g, '\u0000').replace(/&/g, '').replace(/\u0000/g, '&'),
      enabled: item.enabled,
      separator: item.type === 'separator' || undefined,
      checked: item.type === 'checkbox' || item.type === 'radio' ? item.checked : undefined,
      shortcut: item.accelerator?.toString(),
      children: item.submenu ? menuSnapshot(item.submenu, id) : undefined,
    }];
  }) ?? [];
}

export function runMenuItem(id: unknown, window: BrowserWindow): void {
  if (typeof id !== 'string' || !/^\d{1,3}(?:\.\d{1,3}){0,3}$/.test(id)) return;
  let menu = Menu.getApplicationMenu();
  let item: MenuItem | undefined;
  for (const part of id.split('.')) {
    item = menu?.items[Number(part)];
    if (!item?.enabled || !item.visible) return;
    menu = item.submenu ?? null;
  }
  if (!item || item.submenu || item.type === 'separator') return;
  const contents = window.webContents;
  switch (item.role?.toLowerCase()) {
    case 'undo': contents.undo(); break;
    case 'redo': contents.redo(); break;
    case 'cut': contents.cut(); break;
    case 'copy': contents.copy(); break;
    case 'paste': contents.paste(); break;
    case 'pasteandmatchstyle': contents.pasteAndMatchStyle(); break;
    case 'delete': contents.delete(); break;
    case 'selectall': contents.selectAll(); break;
    case 'reload': contents.reload(); break;
    case 'forcereload': contents.reloadIgnoringCache(); break;
    case 'toggledevtools': contents.toggleDevTools(); break;
    case 'resetzoom': contents.setZoomLevel(0); break;
    case 'zoomin': contents.setZoomLevel(contents.getZoomLevel() + 0.5); break;
    case 'zoomout': contents.setZoomLevel(contents.getZoomLevel() - 0.5); break;
    case 'togglefullscreen': window.setFullScreen(!window.isFullScreen()); break;
    case 'minimize': window.minimize(); break;
    case 'zoom': window.isMaximized() ? window.unmaximize() : window.maximize(); break;
    case 'close': window.close(); break;
    case 'front': window.focus(); break;
    case 'about': app.showAboutPanel(); break;
    default: if (!item.role) item.click(item, window, { triggeredByAccelerator: false });
  }
}
