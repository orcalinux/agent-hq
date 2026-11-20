import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { _electron as electron, expect, test } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('native Linux tray activation opens and toggles the quick panel', async ({}, testInfo) => {
  test.skip(process.platform !== 'linux' || !process.env.DBUS_SESSION_BUS_ADDRESS, 'Requires a Linux desktop session with a tray host.');
  const call = (...args: string[]) => execFileSync('gdbus', ['call', '--session', ...args], {
    encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'],
  });
  const list = () => call('--dest', 'org.kde.StatusNotifierWatcher', '--object-path', '/StatusNotifierWatcher',
    '--method', 'org.freedesktop.DBus.Properties.Get', 'org.kde.StatusNotifierWatcher', 'RegisteredStatusNotifierItems');
  try {
    list();
  } catch {
    test.skip(true, 'gdbus or a StatusNotifier tray host is not available.');
  }
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hq-native-tray-'));
  const workspace = path.join(data, 'demo-app');
  fs.mkdirSync(workspace);
  const app = await electron.launch({
    args: [root, ...(process.env.CI ? ['--no-sandbox'] : [])], cwd: root,
    env: {
      ...process.env, AGENT_HQ_USER_DATA: path.join(data, 'user-data'), AGENT_HQ_CONFIG_DIR: path.join(data, 'config'),
      AGENT_HQ_WORKSPACE: workspace, AGENT_HQ_NO_UPDATES: '1', AGENT_HQ_HIDDEN: '1',
      AGENT_HQ_SIMULATE_UPDATE: '', MAGPIE_GATEWAY: '127.0.0.1:9', OLLAMA_HOST: '127.0.0.1:9',
    },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    const pid = app.process().pid;
    let item: { bus: string; path: string } | undefined;
    await expect.poll(() => {
      for (const match of list().matchAll(/'(:[\d.]+)(\/[^']+)'/g)) {
        try {
          const owner = call('--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus',
            '--method', 'org.freedesktop.DBus.GetConnectionUnixProcessID', match[1]);
          if (Number(owner.match(/uint32 (\d+)/)?.[1]) === pid) {
            item = { bus: match[1], path: match[2] };
            return true;
          }
        } catch {
          continue;
        }
      }
      return false;
    }, { timeout: 10000 }).toBe(true);
    const activate = () => call('--dest', item!.bus, '--object-path', item!.path,
      '--method', 'org.kde.StatusNotifierItem.Activate', '1800', '20');
    const opened = app.waitForEvent('window');
    activate();
    const panel = await opened;
    await panel.waitForURL('**/tray.html');
    await expect(panel.getByTestId('tray-panel')).toBeVisible();
    const visible = () => app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/tray.html'))?.isVisible());
    await expect.poll(visible).toBe(true);
    await panel.emulateMedia({ reducedMotion: 'reduce' });
    await panel.screenshot({ path: testInfo.outputPath('native-tray.png'), animations: 'disabled' });
    activate();
    await expect.poll(visible).toBe(false);
    await page.evaluate(() => window.agentHqDesktop!.showTrayPanel());
    await expect.poll(visible).toBe(true);
    const closed = app.waitForEvent('close');
    await panel.getByRole('button', { name: 'Quit', exact: true }).click();
    await closed;
  } finally {
    await app.close();
    fs.rmSync(data, { recursive: true, force: true });
  }
});
