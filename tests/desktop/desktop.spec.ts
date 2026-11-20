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

async function launch(extraEnv: Record<string, string> = {}): Promise<{ app: ElectronApplication; page: Page; errors: string[] }> {
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
      ...extraEnv,
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

test('agent detail cards support editing and discarding in the desktop shell', async () => {
  const { app, page, errors } = await launch();
  try {
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Agents', exact: true }).click();
    await page.getByRole('tab', { name: 'List', exact: true }).click();
    await page.getByRole('textbox', { name: 'Search agents' }).fill('Sovereign');
    await expect(page.getByRole('table', { name: 'Agents', exact: true }).locator('tbody tr')).toHaveCount(1);
    await page.getByRole('button', { name: 'Configure Sovereign', exact: true }).click();
    const panel = page.getByRole('complementary', { name: 'Sovereign', exact: true });
    await expect(panel.getByTestId('agent-stats')).toBeVisible();
    await expect(panel.getByRole('region', { name: 'Role and instructions' })).toBeVisible();
    const title = panel.getByRole('textbox', { name: 'Title', exact: true });
    const original = await title.inputValue();
    await title.fill('Desktop edit');
    await panel.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(title).toHaveValue(original);
    await expect(panel.getByTestId('agent-save-bar')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('Linux window buttons sit inside the title bar and minimize, maximize, restore and close', async () => {
  test.skip(process.platform !== 'linux', 'Linux draws its own window buttons');
  const { app, page, errors } = await launch();
  try {
    const bar = page.getByTestId('desktop-title-bar');
    const barBox = (await bar.boundingBox())!;
    const buttons = ['Minimize', 'Maximize', 'Close'].map((name) => bar.getByRole('button', { name, exact: true }));
    for (const button of buttons) {
      const box = (await button.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(barBox.y);
      expect(box.y + box.height).toBeLessThanOrEqual(barBox.y + barBox.height + 0.5);
      expect(box.x + box.width).toBeLessThanOrEqual(barBox.x + barBox.width + 0.5);
    }
    const isMax = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized());
    const before = await isMax();
    await buttons[1].click();
    await expect.poll(isMax).toBe(!before);
    await expect(bar.getByRole('button', { name: before ? 'Maximize' : 'Restore', exact: true })).toBeVisible();
    await bar.getByRole('button', { name: before ? 'Maximize' : 'Restore', exact: true }).click();
    await expect.poll(isMax).toBe(before);
    await buttons[0].click();
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(true);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

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

test('closing the window keeps quick status available while working and while idle', async () => {
  const { app, page } = await launch();
  const mainVisible = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().endsWith('/tray.html'))?.isVisible());
  const closeMain = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().endsWith('/tray.html'))?.close());
  try {
    await page.evaluate(() => window.agentHqDesktop?.setStatus({ busy: 2, label: '2 agents working · 1/3 tasks', running: true }));
    await expect.poll(mainVisible).toBe(true);
    await closeMain();
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.isVisible()))).toEqual([false]);

    await page.evaluate(() => window.agentHqDesktop?.setStatus({ busy: 0, label: 'Last run finished', running: false }));
    const panel = await openQuickStatus(app, page);
    await expect(panel.getByRole('status')).toContainText('Last run finished');
    await panel.getByRole('button', { name: 'Open Agent HQ', exact: true }).click();
    await expect.poll(mainVisible).toBe(true);
    await closeMain();
    await expect.poll(mainVisible).toBe(false);
  } finally {
    await app.close();
  }
});

async function openQuickStatus(app: ElectronApplication, page: Page): Promise<Page> {
  const existing = app.windows().find((window) => window.url().endsWith('/tray.html'));
  const opened = existing ? Promise.resolve(existing) : app.waitForEvent('window');
  await page.evaluate(() => window.agentHqDesktop?.showTrayPanel());
  const panel = await opened;
  await panel.waitForURL('**/tray.html');
  await expect(panel.getByTestId('tray-panel')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'demo-app', exact: true })).toBeVisible();
  return panel;
}

test('quick status shows live project data in a separate sandboxed panel and opens agent details', async ({}, testInfo) => {
  const { app, page, errors } = await launch();
  try {
    const panel = await openQuickStatus(app, page);
    panel.on('pageerror', (error) => errors.push(error.message));
    await expect(panel.getByRole('status')).toContainText('Idle');
    await expect(panel.getByRole('tabpanel', { name: 'Overview' })).toContainText('Ready when you are');
    await panel.emulateMedia({ reducedMotion: 'reduce' });
    await panel.screenshot({ path: testInfo.outputPath('tray-idle.png'), animations: 'disabled' });
    expect(await panel.evaluate(() => ({
      node: typeof (window as unknown as { require?: unknown }).require,
      mainApi: typeof window.agentHqDesktop,
      methods: Object.keys(window.agentHqTray ?? {}).sort(),
    }))).toEqual({ node: 'undefined', mainApi: 'undefined', methods: ['action', 'getState', 'onState'] });
    await panel.getByRole('tab', { name: /Agents/ }).click();
    await expect(panel.getByRole('button', { name: /^Open (Sovereign|Aegis|Pulse|Titan|Sentinel|Nova|Byte)$/ })).toHaveCount(7);
    await panel.getByRole('button', { name: 'Open Sovereign', exact: true }).click();
    await expect(page.getByRole('complementary', { name: 'Sovereign', exact: true })).toBeVisible();
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/tray.html'))?.isVisible())).toBe(false);
    await openQuickStatus(app, page);
    await panel.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('main', { name: 'settings', exact: true })).toBeVisible();
    await openQuickStatus(app, page);
    await panel.keyboard.press('Escape');
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/tray.html'))?.isVisible())).toBe(false);
    await openQuickStatus(app, page);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/tray.html'))?.emit('blur'));
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/tray.html'))?.isVisible())).toBe(false);
    expect(app.windows()).toHaveLength(2);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('quick status follows live changes and both themes, including long text and unpriced usage', async ({}, testInfo) => {
  const { app, page, errors } = await launch();
  try {
    const panel = await openQuickStatus(app, page);
    await panel.emulateMedia({ reducedMotion: 'reduce' });
    panel.on('pageerror', (error) => errors.push(error.message));
    const snapshot = await panel.evaluate(() => window.agentHqTray!.getState());
    await page.evaluate((snapshot) => {
      window.agentHqDesktop!.setStatus({ busy: 2, running: true, label: '2 agents working · 1/3 tasks' });
      window.agentHqDesktop!.setTraySnapshot({
        ...snapshot,
        project: 'مشروع طويل للاختبار — project-' + 'x'.repeat(100),
        mission: { title: 'Task ' + 'x'.repeat(250), total: 3, completed: 1, failed: 1, review: 2, source: 'simulation' },
        usage: { calls: 3, totalTokens: 15000, estimatedCostUSD: 0, unpricedTokens: 15000 },
        activity: [{ id: 'event', agent: 'Sovereign', timestamp: Date.now(), level: 'error', text: 'Error ' + 'x'.repeat(300) }],
      });
    }, snapshot);
    await expect(panel.getByRole('status')).toContainText('2 agents working');
    await expect(panel.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
    await expect(panel.getByRole('tabpanel')).toContainText('Estimated cost: unpriced');
    await expect(panel.getByRole('tabpanel')).toContainText('2 changes ready to review');
    await expect(panel.getByRole('status')).toContainText('Demo run');
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((theme) => window.agentHqDesktop!.setTheme(theme), theme);
      await expect(panel.locator('html')).toHaveAttribute('data-theme', theme);
      for (const tab of ['Overview', 'Agents', 'Activity']) {
        await panel.getByRole('tab', { name: tab, exact: tab !== 'Agents' }).click();
        await expect(panel.getByRole('tab', { name: tab, exact: tab !== 'Agents' })).toHaveAttribute('aria-selected', 'true');
        expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await panel.screenshot({ path: testInfo.outputPath(`tray-${theme}-${tab.toLowerCase()}.png`), animations: 'disabled' });
      }
    }
    await panel.getByRole('button', { name: 'Close quick status', exact: true }).click();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
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

const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version as string;
const prefsFile = () => path.join(dirs.userData, 'update-prefs.json');
const lastFile = () => path.join(dirs.userData, 'last-version');

test('a downloaded update shows the Update pill, its notes, and restarts from there', async () => {
  fs.rmSync(prefsFile(), { force: true });
  const { app, page, errors } = await launch({ AGENT_HQ_SIMULATE_UPDATE: '99.0.0' });
  try {
    const pill = page.getByTestId('update-button');
    await expect(pill).toHaveAttribute('data-kind', 'ready', { timeout: 15_000 });
    await expect(pill).toHaveText('Update');
    await expect(pill).toHaveAttribute('title', 'Restart to update to v99.0.0');
    const bar = await page.getByTestId('desktop-title-bar').boundingBox();
    const box = await pill.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(bar!.y);
    expect(box!.y + box!.height).toBeLessThanOrEqual(bar!.y + bar!.height);

    await pill.click();
    const dialog = page.getByRole('dialog', { name: 'Update to v99.0.0' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Simulated update');
    await expect(dialog.getByTestId('release-notes')).toHaveCount(1);
    await expect(dialog.getByRole('button', { name: 'Later' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Later' }).click();
    await expect(dialog).toBeHidden();
    await expect(pill).toBeVisible();

    const panel = await openQuickStatus(app, page);
    await panel.getByRole('button', { name: /v99.0.0 is ready/ }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Later' }).click();

    await pill.click();
    await page.getByTestId('update-restart').click();
    await expect(pill).toBeHidden();

    await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Updates' }).click();
    await expect(page.getByTestId('update-status')).toContainText('Up to date');
    await expect(page.getByTestId('update-version-row')).toContainText(`v${version}`);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('with automatic download off, the pill offers the update and downloads it on a click', async () => {
  fs.writeFileSync(prefsFile(), JSON.stringify({ autoDownload: false }));
  const { app, page, errors } = await launch({ AGENT_HQ_SIMULATE_UPDATE: '99.0.0' });
  try {
    const pill = page.getByTestId('update-button');
    await expect(pill).toHaveAttribute('data-kind', 'available', { timeout: 15_000 });
    await expect(pill).toHaveAttribute('title', /v99\.0\.0 is out · 98\.4 MB/);
    await pill.click();
    await expect(pill).toHaveAttribute('data-kind', 'downloading');
    await expect(pill).toContainText('Downloading…');
    await expect(page.getByRole('dialog', { name: 'Update to v99.0.0' })).toBeVisible({ timeout: 15_000 });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    fs.rmSync(prefsFile(), { force: true });
  }
});

test('the × hides the pill for 3 days and Settings can show it again', async () => {
  fs.rmSync(prefsFile(), { force: true });
  const { app, page } = await launch({ AGENT_HQ_SIMULATE_UPDATE: '99.0.0' });
  try {
    const pill = page.getByTestId('update-button');
    await expect(pill).toHaveAttribute('data-kind', 'ready', { timeout: 15_000 });
    await pill.hover();
    await page.getByTestId('update-hide').click();
    await expect(pill).toBeHidden();
    const saved = JSON.parse(fs.readFileSync(prefsFile(), 'utf8'));
    expect(saved.hiddenVersion).toBe('99.0.0');
    expect(saved.hiddenUntil).toBeGreaterThan(Date.now() + 2 * 24 * 3600 * 1000);

    await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Settings', exact: true }).click();
    const updates = page.getByTestId('settings-updates');
    await updates.getByRole('button', { name: 'Show again' }).click();
    await expect(pill).toBeVisible();
    await updates.getByRole('tablist', { name: 'Update button' }).getByRole('tab', { name: 'Off' }).click();
    await expect(pill).toBeHidden();
    expect(JSON.parse(fs.readFileSync(prefsFile(), 'utf8')).showButton).toBe(false);
  } finally {
    await app.close();
    fs.rmSync(prefsFile(), { force: true });
  }
});

test("the first launch after an update shows What's new once", async () => {
  fs.writeFileSync(lastFile(), '0.0.1');
  let { app, page } = await launch();
  try {
    const dialog = page.getByRole('dialog', { name: `What's new in v${version}` });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('updated from v0.0.1');
    await expect(dialog.getByTestId('release-notes').first()).toHaveAttribute('data-version', version);
    await dialog.getByRole('button', { name: 'Got it' }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => fs.readFileSync(lastFile(), 'utf8').trim()).toBe(version);
  } finally {
    await app.close();
  }
  ({ app, page } = await launch());
  try {
    await expect(page.getByTestId('desktop-title-bar')).toBeVisible();
    await page.waitForTimeout(800);
    await expect(page.getByRole('dialog', { name: /What's new/ })).toHaveCount(0);
  } finally {
    await app.close();
  }
});
