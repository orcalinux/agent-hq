import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
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

test('native desktop shortcuts tile the main window into the available work area', async ({}, testInfo) => {
  test.skip(process.platform !== 'linux' || process.env.AGENT_HQ_TEST_TILING !== '1', 'Requires X11, Xfwm and xdotool; enable with AGENT_HQ_TEST_TILING=1.');
  const shortcuts = execFileSync('xfconf-query', ['-c', 'xfce4-keyboard-shortcuts', '-lv'], { encoding: 'utf8' });
  const shortcutFor = (action: string) => {
    const bindings = shortcuts.split('\n').filter((line) => line.trim().endsWith(` ${action}`));
    const binding = bindings.find((line) => line.startsWith('/xfwm4/custom/')) ?? bindings[0];
    if (!binding) throw new Error(`No desktop shortcut configured for ${action}`);
    const accelerator = binding.trim().split(/\s+/)[0].replace(/^\/xfwm4\/(?:custom|default)\//, '');
    return accelerator.replace(/<(Super|Primary|Control|Alt|Shift)>/g, (_, modifier: string) => ({
      Super: 'Super_L+', Primary: 'Control_L+', Control: 'Control_L+', Alt: 'Alt_L+', Shift: 'Shift_L+',
    })[modifier]!);
  };
  const { app, page, errors } = await launch({ SHELL: path.join(root, 'tests/demo/shell/bash') });
  try {
    const windowId = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readUInt32LE(0));
    const area = await app.evaluate(({ BrowserWindow, screen }) => screen.getDisplayMatching(BrowserWindow.getAllWindows()[0].getBounds()).workArea);
    for (const edge of ['left', 'right', 'up', 'down']) {
      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.unmaximize();
        window.setBounds({ x: 100, y: 100, width: 1100, height: 700 });
        window.show();
        window.focus();
      });
      execFileSync('xdotool', ['windowactivate', '--sync', String(windowId)]);
      execFileSync('xdotool', ['key', '--clearmodifiers', shortcutFor(`tile_${edge}_key`)]);
      await expect.poll(async () => {
        const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
        const horizontal = edge === 'left' || edge === 'right';
        const expected = {
          x: area.x + (edge === 'right' ? Math.floor(area.width / 2) : 0),
          y: area.y + (edge === 'down' ? Math.floor(area.height / 2) : 0),
          width: horizontal ? Math.floor(area.width / 2) : area.width,
          height: horizontal ? area.height : Math.floor(area.height / 2),
        };
        return Object.entries(expected).every(([key, value]) => Math.abs(bounds[key as keyof typeof bounds] - value) <= 2);
      }, { message: `OS shortcut should tile ${edge}` }).toBe(true);
      await expect(page.getByTestId('desktop-title-bar')).toBeVisible();
      await expect.poll(() => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth))).toBe(0);
      const layout = page.getByRole('group', { name: 'Layout', exact: true });
      await layout.getByRole('button', { name: 'Chat', exact: true }).click();
      const composer = page.getByRole('textbox', { name: 'Message Sovereign', exact: true });
      await composer.fill('Keep this draft while changing layouts');
      await layout.getByRole('button', { name: 'Code', exact: true }).click();
      await page.keyboard.press('Control+l');
      await expect(composer).toBeVisible();
      await expect(composer).toBeFocused();
      await expect(composer).toHaveValue('Keep this draft while changing layouts');
      await layout.getByRole('button', { name: 'Code', exact: true }).click();
      await page.screenshot({ path: testInfo.outputPath(`tiling-${edge}.png`) });
    }
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

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

test('shared dialog motion runs in Electron and retains modality until exit completes', async () => {
  const { app, page, errors } = await launch();
  try {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Agents', exact: true }).click();
    const opener = page.getByRole('button', { name: 'Add agent', exact: true });
    await opener.focus();
    const entering = await opener.evaluate(async (button) => {
      (button as HTMLButtonElement).click();
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const surface = document.querySelector('.ahq-dialog-surface')!;
      const animations = surface.getAnimations();
      const moving = animations.some((animation) => (animation.effect as KeyframeEffect | null)?.getKeyframes().some((frame) => 'transform' in frame));
      await Promise.all(animations.map((animation) => animation.finished));
      return moving;
    });
    expect(entering).toBe(true);
    const dialog = page.getByRole('dialog', { name: 'Add agent', exact: true });
    const exiting = await dialog.getByRole('button', { name: 'Cancel', exact: true }).evaluate(async (button) => {
      (button as HTMLButtonElement).click();
      await Promise.resolve();
      return {
        retained: !!document.querySelector('.ahq-dialog-overlay[data-open="false"]'),
        inert: document.getElementById('root')!.inert,
      };
    });
    expect(exiting).toEqual({ retained: true, inert: true });
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await opener.click();
    await expect(dialog).toHaveCSS('transform', 'none');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
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

test('quick status shows what the team learned and opens Growth', async () => {
  const memoryDir = path.join(dirs.workspace, '.agent-hq', 'memory');
  const now = Date.now();
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.writeFileSync(path.join(memoryDir, 'lessons.json'), JSON.stringify({
    version: 1,
    lessons: [
      { id: 'a', agentId: 'agent-frontend', kind: 'convention', text: 'Style buttons with Tailwind classes.', source: 'user', createdAt: now, updatedAt: now, reinforced: 6, uses: 10 },
      { id: 'b', agentId: 'team', kind: 'preference', text: 'Keep commit messages short.', source: 'user', createdAt: now, updatedAt: now, reinforced: 0, uses: 0 },
    ],
  }));
  const { app, page, errors } = await launch();
  try {
    const panel = await openQuickStatus(app, page);
    const learning = panel.getByTestId('tray-learning');
    await expect(learning).toContainText('2 lessons learned · 2 this week');
    await expect(learning).toContainText('Most experienced: Pulse (Learning)');
    await learning.click();
    await expect(page.getByRole('main', { name: 'growth', exact: true })).toBeVisible();
    await expect(page.getByTestId('growth-card').first()).toHaveAttribute('aria-label', 'Pulse growth');
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    fs.rmSync(memoryDir, { recursive: true, force: true });
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

test('the About dialog shows the logo, credits and the full MIT license from the themed Help menu', async ({}, testInfo) => {
  test.skip(process.platform === 'darwin', 'macOS keeps its native About panel.');
  const { app, page, errors } = await launch();
  try {
    await page.getByRole('button', { name: 'Application menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Help', exact: true }).click();
    await page.getByRole('menuitem', { name: /^About Agent HQ/ }).click();
    const about = page.getByTestId('about-dialog');
    await expect(about).toBeVisible();
    const logo = about.locator('img');
    await expect(logo).toHaveJSProperty('complete', true);
    expect(await logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    await expect(about.getByText(/Version \d+\.\d+\.\d+/)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('about.png') });
    await about.getByRole('tab', { name: 'Credits' }).click();
    await expect(about.getByRole('link', { name: 'Electron', exact: true })).toBeVisible();
    await about.getByRole('tab', { name: 'License' }).click();
    await expect(about.getByLabel('MIT License')).toContainText('Permission is hereby granted, free of charge');
    await page.keyboard.press('Escape');
    await expect(about).toBeHidden();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('desktop chat completes commands and agent mentions without sending', async () => {
  const { app, page, errors } = await launch();
  try {
    const input = page.getByRole('textbox', { name: 'Message Sovereign', exact: true });
    const menu = page.getByTestId('chat-completions');
    await input.fill('/rem');
    await expect(menu.getByRole('option')).toContainText('/remember');
    await input.press('Tab');
    await expect(input).toHaveValue('/remember ');
    await input.pressSequentially('@pu');
    await expect(menu.getByRole('option')).toContainText('@Pulse');
    await input.press('Enter');
    await expect(input).toHaveValue('/remember @Pulse ');
    await expect(input).toBeFocused();
    await expect(menu).toBeHidden();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('desktop chat commands run: /plan switches mode and /team completes its options', async ({}, testInfo) => {
  const { app, page, errors } = await launch();
  try {
    const input = page.getByRole('textbox', { name: 'Message Sovereign', exact: true });
    const menu = page.getByTestId('chat-completions');
    for (const [width, height] of [[640, 360], [1000, 700], [1440, 900]]) {
      await app.evaluate(({ BrowserWindow }, bounds) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.unmaximize();
        window.setSize(bounds[0], bounds[1]);
      }, [width, height]);
      if (!(await input.isVisible().catch(() => false))) {
        await page.getByRole('tab', { name: 'Chat', exact: true }).or(page.getByRole('button', { name: 'Chat', exact: true })).first().click();
      }
      await input.fill('/team ');
      await expect(menu.getByRole('option')).toHaveCount(2);
      await page.screenshot({ path: testInfo.outputPath(`chat-commands-${width}.png`) });
      await input.press('Escape');
      await input.fill('/plan');
      await input.press('Escape');
      await input.press('Enter');
      await expect(page.getByRole('tab', { name: 'Plan' })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByTestId('chat-system-note').last()).toHaveText('Switched to Plan mode.');
    }
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('the themed application menu fits narrow windows and supports keyboard, native actions and both themes', async ({}, testInfo) => {
  test.skip(process.platform === 'darwin', 'macOS keeps its native application menu.');
  const { app, page, errors } = await launch();
  try {
    const trigger = page.getByRole('button', { name: 'Application menu', exact: true });
    for (const [width, height] of [[640, 360], [1000, 700], [1440, 900]]) {
      await app.evaluate(({ BrowserWindow }, bounds) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.unmaximize();
        window.setBounds(bounds);
      }, { x: 0, y: 0, width, height });
      for (const theme of ['light', 'dark']) {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (await page.evaluate((mode) => document.documentElement.dataset.theme === mode, theme)) break;
          await page.getByRole('button', { name: /theme/ }).first().click();
        }
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await trigger.click();
        const menu = page.getByTestId('application-menu');
        await expect(menu).toBeVisible();
        await expect(menu.getByRole('menuitem', { name: 'File', exact: true })).toBeFocused();
        const box = await menu.boundingBox();
        const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
        expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
        await page.keyboard.press('v');
        await expect(menu.getByRole('menuitem', { name: 'View', exact: true })).toBeFocused();
        await page.keyboard.press('ArrowRight');
        await expect(menu.getByRole('menu', { name: 'View', exact: true })).toBeVisible();
        await menu.evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => undefined))); });
        await page.screenshot({ path: testInfo.outputPath(`menu-${width}-${theme}.png`) });
        await page.keyboard.press('ArrowLeft');
        await expect(menu.getByRole('menu', { name: 'Application', exact: true })).toBeVisible();
        await page.keyboard.press('End');
        await expect(menu.getByRole('menuitem', { name: 'Check for updates', exact: true })).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(menu).toBeHidden();
        await expect(trigger).toBeFocused();
      }
    }
    await trigger.click();
    await page.getByRole('menuitem', { name: 'View', exact: true }).click();
    const zoomBefore = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomLevel());
    await page.getByRole('menuitem', { name: /Zoom In/i }).click();
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomLevel())).toBe(zoomBefore + 0.5);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomLevel(0));
    await trigger.click();
    await page.getByRole('menuitem', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: /^Settings/ }).click();
    await expect(page.getByRole('main', { name: 'settings', exact: true })).toBeVisible();
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.setAttribute('aria-label', 'Menu editing check');
      input.value = 'Native editing still works';
      input.style.cssText = 'position:fixed;top:80px;left:300px;z-index:40';
      document.body.append(input);
      input.focus();
      input.select();
    });
    await trigger.click();
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
    await page.getByRole('menuitem', { name: /^Copy/ }).click();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('Native editing still works');
    await page.evaluate(() => document.querySelector('[aria-label="Menu editing check"]')?.remove());
    await page.evaluate(() => { window.agentHqDesktop?.runMenuItem('__proto__'); window.agentHqDesktop?.runMenuItem('999.999'); });
    await expect(page.getByTestId('desktop-title-bar')).toBeVisible();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await trigger.click();
    const menu = page.getByTestId('application-menu');
    expect(await menu.evaluate((element) => getComputedStyle(element).transform)).toBe('none');
    await page.keyboard.press('Tab');
    await expect(menu).toBeHidden();
    await trigger.click();
    await page.getByRole('main', { name: 'settings', exact: true }).click({ position: { x: 500, y: 40 } });
    await expect(menu).toBeHidden();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version as string;
const prefsFile = () => path.join(dirs.userData, 'update-prefs.json');
const lastFile = () => path.join(dirs.userData, 'last-version');

test('manual update checks work with automatic checks off, show progress and keep the app usable after release notes', async ({}, testInfo) => {
  fs.mkdirSync(dirs.userData, { recursive: true });
  fs.writeFileSync(prefsFile(), JSON.stringify({ auto: false, autoDownload: false, showButton: false }));
  const { app, page, errors } = await launch({ AGENT_HQ_SIMULATE_UPDATE: '99.0.0' });
  try {
    await expect.poll(() => page.evaluate(async () => (await window.agentHqDesktop!.getUpdateState()).status)).toBe('idle');
    await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
    const center = page.getByRole('dialog', { name: 'Agent HQ updates', exact: true });
    await expect(center).toContainText('Looking for updates');
    await expect(center).toContainText('A new version is available');
    for (const [width, height] of [[640, 360], [1440, 900]]) {
      await app.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setBounds(bounds), { x: 0, y: 0, width, height });
      await center.evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => undefined))); });
      await page.screenshot({ path: testInfo.outputPath(`update-center-${width}.png`) });
      await expect(center.getByRole('button', { name: 'Download update', exact: true })).toBeInViewport();
    }
    await expect(center).toContainText('Automatic checks are off');
    expect(await page.evaluate(async () => (await window.agentHqDesktop!.getUpdatePrefs()).auto)).toBe(false);
    await center.getByRole('button', { name: 'Download update', exact: true }).click();
    await expect(center.getByRole('progressbar', { name: 'Update download' })).toBeVisible();
    await expect(center).toContainText('Your update is ready');
    await center.getByRole('button', { name: 'Review and restart', exact: true }).click();
    const notes = page.getByRole('dialog', { name: 'Update to v99.0.0', exact: true });
    await expect(notes).toBeVisible();
    await notes.getByRole('button', { name: 'Later', exact: true }).click();
    await expect(notes).toBeHidden();
    await expect.poll(() => page.evaluate(() => document.getElementById('root')!.inert)).toBe(false);
    await expect(page.getByRole('button', { name: 'Check for updates', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
    await expect(center).toContainText('Your update is ready');
    await center.getByRole('button', { name: 'Update settings', exact: true }).click();
    await expect(center).toBeHidden();
    await expect(page.getByTestId('update-version-row')).toBeInViewport();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    fs.rmSync(prefsFile(), { force: true });
  }
});

test('manual checks from the native Help menu and themed menu report up-to-date and unsupported builds', async () => {
  fs.mkdirSync(dirs.userData, { recursive: true });
  fs.writeFileSync(prefsFile(), JSON.stringify({ auto: false }));
  const { app, page, errors } = await launch({ AGENT_HQ_SIMULATE_UPDATE: version });
  try {
    await app.evaluate(({ Menu, BrowserWindow }) => {
      const item = Menu.getApplicationMenu()?.items.find((entry) => entry.role === 'help')?.submenu?.items.find((entry) => entry.label === 'Check for Updates…');
      item?.click(item, BrowserWindow.getAllWindows()[0], {});
    });
    const center = page.getByRole('dialog', { name: 'Agent HQ updates', exact: true });
    await expect(center).toContainText('You’re up to date');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('desktop:update', { status: 'error', current: '0.16.0', error: 'Connection timed out' }));
    await expect(center).toContainText('Connection timed out');
    await center.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(center).toContainText('You’re up to date');
    await center.getByRole('button', { name: 'Close', exact: true }).click();
    if (process.platform !== 'darwin') {
      await page.getByRole('button', { name: 'Application menu', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Check for updates', exact: true }).click();
      await expect(center).toContainText('You’re up to date');
    }
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    fs.rmSync(prefsFile(), { force: true });
  }
  const unsupported = await launch();
  try {
    await unsupported.page.getByRole('button', { name: 'Check for updates', exact: true }).click();
    await expect(unsupported.page.getByRole('dialog', { name: 'Agent HQ updates', exact: true })).toContainText('You’re running a development build');
    await expect(unsupported.page.getByRole('link', { name: 'View releases' })).toBeVisible();
  } finally {
    await unsupported.app.close();
  }
});

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

test('a failed install keeps the dialog open with the reason and a command to run by hand', async () => {
  fs.rmSync(prefsFile(), { force: true });
  const { app, page, errors } = await launch({ AGENT_HQ_SIMULATE_UPDATE: '99.0.0', AGENT_HQ_SIMULATE_INSTALL_FAILURE: '1' });
  try {
    const pill = page.getByTestId('update-button');
    await expect(pill).toHaveAttribute('data-kind', 'ready', { timeout: 15_000 });
    await pill.click();
    const dialog = page.getByRole('dialog', { name: 'Update to v99.0.0' });
    await dialog.getByTestId('update-restart').click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('update-install-failed')).toContainText('nothing was installed');
    await expect(dialog.getByTestId('update-install-failed')).toContainText('sudo dpkg -i');
    await expect(dialog.getByTestId('update-restart')).toHaveText('Try again');
    await expect(dialog.getByRole('button', { name: 'Later' })).toBeEnabled();
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

test('killing the app mid-run keeps finished work and a pending approval on the next start', async () => {
  const mission = {
    id: 'run-kill', presetId: 'custom', source: 'live', title: 'Killed mid-run', prompt: 'x', status: 'running', startedAt: Date.now(), currentStage: 'implementation', stageIndex: 2,
    tasks: [
      { id: 'done', title: 'Finished task', description: '', stage: 'implementation', assignedAgentId: 'agent-frontend', status: 'completed', priority: 'medium', progress: 100, tags: [], dependsOn: [], output: 'kept' },
      { id: 'mid', title: 'Mid-flight task', description: '', stage: 'implementation', assignedAgentId: 'agent-backend', status: 'in_progress', priority: 'medium', progress: 40, tags: [], dependsOn: [] },
    ],
    proposedChanges: [{ id: 'done:src/new.ts', path: 'src/new.ts', content: 'export const kept = true;\n', taskId: 'done', agentId: 'agent-frontend', status: 'pending' }],
  };
  const first = await launch({ AGENT_HQ_USER_DATA: path.join(base, 'user-data-kill-1') });
  const pid = first.app.process().pid!;
  try {
    const saved = await first.page.evaluate(async (body) => (await fetch('/api/runs/journal', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mission: body }) })).ok, mission);
    expect(saved).toBe(true);
    process.kill(pid, 'SIGKILL');
  } finally {
    await first.app.close().catch(() => undefined);
  }
  const second = await launch({ AGENT_HQ_USER_DATA: path.join(base, 'user-data-kill-2') });
  try {
    await expect.poll(() => second.page.evaluate(() => JSON.parse(localStorage.getItem('agent-hq.state') ?? '{}').state?.activeMission?.id), { timeout: 15000 }).toBe('run-kill');
    const restored = await second.page.evaluate(() => JSON.parse(localStorage.getItem('agent-hq.state')!).state.activeMission);
    expect(restored).toMatchObject({ status: 'cancelled', interrupted: true });
    expect(restored.tasks.map((task: { status: string }) => task.status)).toEqual(['completed', 'pending']);
    expect(restored.tasks[0].output).toBe('kept');
    expect(restored.proposedChanges).toHaveLength(1);
    expect(restored.proposedChanges[0]).toMatchObject({ path: 'src/new.ts', status: 'pending' });
    await second.page.evaluate(() => fetch('/api/runs/journal', { method: 'DELETE' }));
  } finally {
    await second.app.close();
  }
});
