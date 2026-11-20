import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const base = path.join(os.tmpdir(), 'agent-hq-desktop-e2e');
const dirs = {
  workspace: path.join(base, 'demo-app'),
  config: path.join(base, 'config'),
  userData: path.join(base, 'user-data'),
};

function freshDirs(): void {
  fs.rmSync(base, { recursive: true, force: true });
  fs.mkdirSync(path.join(dirs.workspace, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dirs.workspace, 'package.json'), JSON.stringify({ name: 'demo-app', version: '1.0.0' }, null, 2));
  fs.writeFileSync(path.join(dirs.workspace, 'src', 'index.ts'), 'export const hello = () => "hi";\n');
}

async function launch(): Promise<{ app: ElectronApplication; page: Page; errors: string[] }> {
  const app = await electron.launch({
    args: [root, ...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : [])],
    cwd: root,
    env: {
      ...process.env,
      AGENT_HQ_WORKSPACE: dirs.workspace,
      AGENT_HQ_CONFIG_DIR: dirs.config,
      AGENT_HQ_USER_DATA: dirs.userData,
      AGENT_HQ_NO_UPDATES: '1',
      MAGPIE_GATEWAY: '127.0.0.1:9',
      OLLAMA_HOST: '127.0.0.1:9',
    },
  });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && /Content Security Policy|Refused to/i.test(msg.text())) errors.push(msg.text());
  });
  await page.waitForLoadState('domcontentloaded');
  return { app, page, errors };
}

test.beforeAll(freshDirs);

test('desktop app starts its own server, loads the UI and talks to the shell', async () => {
  const { app, page, errors } = await launch();
  try {
    await expect(page).toHaveTitle('Agent HQ');
    expect(page.url()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    await expect(page.getByRole('navigation').getByText('Workspace')).toBeVisible();
    const titleBar = page.getByTestId('desktop-title-bar');
    await expect(titleBar).toContainText('demo-app');
    await expect(titleBar).toContainText('Idle');
    if (process.platform !== 'darwin') await expect(titleBar.getByRole('button', { name: 'Application menu' })).toBeVisible();
    await page.getByRole('button', { name: /Light theme/ }).click();
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBackgroundColor().toLowerCase())).toBe('#f6f6f8');
    await page.getByRole('button', { name: /Dark theme/ }).click();

    const health = await page.evaluate(async () => (await fetch('/api/health')).json());
    expect(health.ok).toBe(true);
    expect(health.workspace).toBe(dirs.workspace);

    const desktop = await page.evaluate(() => ({ platform: window.agentHqDesktop?.platform, version: window.agentHqDesktop?.version, nodeExposed: typeof (window as unknown as { require?: unknown }).require }));
    expect(desktop.platform).toBe(process.platform);
    expect(desktop.version).toBe(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version);
    expect(desktop.nodeExposed).toBe('undefined');
    expect(await page.evaluate(() => document.documentElement.dataset.desktop)).toBe(process.platform);

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('desktop:command', { type: 'navigate', view: 'agents' }));
    await expect(page.locator('main[aria-label="agents"]')).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('desktop:command', { type: 'navigate', view: 'connections' }));
    await expect(page.locator('main[aria-label="connections"]')).toBeVisible();
    await expect(page.getByText('Magpie gateway').first()).toBeVisible();

    const menu = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map((i) => i.label) ?? []);
    expect(menu).toEqual(expect.arrayContaining(['File', 'View', 'Help']));

    await app.evaluate(({ shell }) => {
      const opened: string[] = [];
      (globalThis as unknown as { opened: string[] }).opened = opened;
      shell.openExternal = async (url: string) => {
        opened.push(url);
      };
    });
    const before = page.url();
    await page.evaluate(() => window.open('https://example.com/docs', '_blank'));
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened)).toEqual(['https://example.com/docs']);
    expect(app.windows().length).toBe(1);
    expect(page.url()).toBe(before);

    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setSize(1200, 760);
      win.emit('resize');
    });
    await page.waitForTimeout(700);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }

  const state = JSON.parse(fs.readFileSync(path.join(dirs.userData, 'window-state.json'), 'utf8'));
  expect(state).toMatchObject({ width: 1200, height: 760, maximized: false });
});

test('a second launch reuses the same origin and remembers the window size', async () => {
  const { app, page } = await launch();
  try {
    expect(page.url()).toMatch(/^http:\/\/127\.0\.0\.1:4782\d\/$/);
    const size = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize());
    expect(size).toEqual([1200, 760]);
  } finally {
    await app.close();
  }
});

test('closing the window during a run keeps the app running in the tray', async () => {
  const { app, page } = await launch();
  try {
    await page.evaluate(() => window.agentHqDesktop?.setStatus({ busy: 2, label: '2 agents working · 1/3 tasks', running: true }));
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.isVisible()))).toEqual([false]);

    await page.evaluate(() => window.agentHqDesktop?.setStatus({ busy: 0, label: 'Last run finished', running: false }));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
    const closed = app.waitForEvent('close');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await closed;
  } catch (err) {
    await app.close();
    throw err;
  }
});

test('built desktop opens every view, role cards, settings sections and Office lighting', async () => {
  const { app, page, errors } = await launch();
  try {
    const nav = page.getByRole('navigation', { name: 'Primary' });
    for (const view of ['Workspace', 'Tasks', 'Reports', 'Connections', 'Settings', 'Agents']) {
      await nav.getByRole('button', { name: view, exact: true }).click();
      const main = page.getByRole('main', { name: view.toLowerCase(), exact: true });
      await expect(main).toBeVisible();
      if (view !== 'Workspace') await expect(main.getByRole('heading', { level: 1 })).toContainText(view);
      await expect(main.getByRole('alert')).toHaveCount(0);
      if (view === 'Connections') {
        await page.getByRole('tab', { name: 'Role defaults' }).click();
        await expect(page.getByRole('button', { name: /^Default model for/ })).toHaveCount(6);
      }
      if (view === 'Settings') {
        const sections = page.getByRole('navigation', { name: 'Settings sections' });
        await sections.getByRole('button', { name: 'Keyboard shortcuts' }).click();
        await expect(page.getByRole('heading', { name: 'Keyboard shortcuts', exact: true })).toBeInViewport();
        await sections.getByRole('button', { name: 'Appearance', exact: true }).click();
        await expect(page.getByRole('tablist', { name: 'Theme', exact: true })).toBeInViewport();
      }
      if (view === 'Agents') {
        await page.getByRole('tab', { name: 'Office', exact: true }).click();
        await expect(page.getByRole('img', { name: 'Office floor plan' })).toBeVisible();
        await page.getByRole('radio', { name: 'Night', exact: true }).click();
        await expect(page.getByRole('radio', { name: 'Night', exact: true })).toHaveAttribute('aria-checked', 'true');
      }
    }
    await page.reload();
    await expect(page.getByRole('main', { name: 'agents', exact: true }).getByRole('heading', { level: 1 })).toContainText('Agents');
    await nav.getByRole('button', { name: /demo-app/ }).click();
    const picker = page.getByRole('dialog', { name: 'Project', exact: true });
    await expect(picker).toBeVisible();
    const bounds = await picker.boundingBox();
    expect(bounds!.width).toBeGreaterThan(600);
    const viewportWidth = await page.evaluate(() => innerWidth);
    expect(Math.abs(bounds!.x + bounds!.width / 2 - viewportWidth / 2)).toBeLessThan(2);
    await picker.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('built desktop recovers from a missing view chunk without clearing settings', async () => {
  const { app, page } = await launch();
  try {
    await page.evaluate(() => localStorage.setItem('agent-hq.recovery-test', 'preserve desktop state'));
    const chunk = /\/assets\/TasksView[^/?]*\.js(?:\?|$)/;
    await page.route(chunk, (route) => route.abort('failed'));
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Tasks', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Reload to load this view' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear saved browser data' })).toHaveCount(0);
    await page.unroute(chunk);
    await page.getByRole('button', { name: 'Reload app' }).click();
    await expect(page.getByRole('main', { name: 'tasks', exact: true }).getByRole('heading', { level: 1 })).toContainText('Tasks');
    expect(await page.evaluate(() => localStorage.getItem('agent-hq.recovery-test'))).toBe('preserve desktop state');
  } finally {
    await app.close();
  }
});

test('built desktop opens an integrated terminal in the project and stops its shells on quit', async () => {
  const { app, page, errors } = await launch();
  let pid = 0;
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('desktop:command', { type: 'open-terminal' }));
    const terminal = page.getByTestId('integrated-terminal');
    await expect(terminal.getByRole('tab')).toHaveCount(1);
    const rows = terminal.locator('.xterm-rows');
    await terminal.locator('.xterm-helper-textarea').focus();
    await page.keyboard.type('pwd && echo $((6*7))-from-electron');
    await page.keyboard.press('Enter');
    await expect(rows).toContainText('42-from-electron');
    await expect(rows).toContainText(path.basename(dirs.workspace));
    await page.keyboard.type('stty size');
    await page.keyboard.press('Enter');
    await expect(rows).toContainText(/\d+ \d+/);
    pid = (await page.evaluate(async () => (await (await fetch('/api/terminal/sessions')).json()).sessions[0].pid)) as number;
    expect(pid).toBeGreaterThan(0);
    expect(() => process.kill(pid, 0)).not.toThrow();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
  await expect
    .poll(() => {
      try {
        process.kill(pid, 0);
        return 'alive';
      } catch {
        return 'stopped';
      }
    })
    .toBe('stopped');
});
