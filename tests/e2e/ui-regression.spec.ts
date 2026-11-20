import fs from 'fs';
import path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { E2E_WORKSPACE, FIXTURE_FILES, resetFixtureWorkspace } from './fixture';
import { mockProvider, pick, trapErrors } from './mocks';

const go = (page: Page, view: string) =>
  page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: view, exact: true }).click();

test.beforeEach(() => resetFixtureWorkspace());

for (const theme of ['light', 'dark'] as const) {
  test(`agent details match the app and preserve edits in ${theme} theme`, async ({ page }, testInfo) => {
    const errors = trapErrors(page);
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await mockProvider(page);
    await page.goto('/');
    await go(page, 'Agents');
    await page.getByRole('tab', { name: 'List', exact: true }).click();
    await page.getByText('Sovereign', { exact: true }).first().click();
    const panel = page.getByRole('complementary', { name: 'Sovereign', exact: true });
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId('agent-stats')).toContainText('Tasks done / failed');
    for (const name of ['Model', 'Role and instructions', 'Prompt and review', 'Task history', 'Recent activity']) {
      await expect(panel.getByRole('region', { name, exact: true })).toBeVisible();
    }
    const title = panel.getByRole('textbox', { name: 'Title', exact: true });
    const original = await title.inputValue();
    await expect(panel.getByTestId('agent-save-bar')).toHaveCount(0);
    await title.fill('Temporary title');
    await expect(panel.getByTestId('agent-save-bar')).toContainText('Unsaved changes');
    await panel.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(title).toHaveValue(original);
    await expect(panel.getByTestId('agent-save-bar')).toHaveCount(0);
    await title.fill('Updated orchestrator');
    await panel.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(panel.getByRole('status')).toHaveText('Saved');
    await expect(panel).toContainText('Updated orchestrator');
    await panel.getByRole('button', { name: 'Close details', exact: true }).click();
    await expect(panel).toHaveCount(0);
    await page.reload();
    await page.getByText('Sovereign', { exact: true }).first().click();
    await expect(title).toHaveValue('Updated orchestrator');
    for (const width of [1000, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`agent-detail-${width}.png`) });
    }
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('role onboarding, individual assignment and reload preserve the team', async ({ page }) => {
  const errors = trapErrors(page);
  await mockProvider(page, 100, { magpie: true });
  await page.goto('/');
  await go(page, 'Connections');
  await page.getByRole('tab', { name: 'Role defaults' }).click();
  await expect(page.getByRole('img', { name: '0 of 6 roles ready' })).toBeVisible();
  await pick(page, 'Default model for Orchestrator (Sovereign)', 'Mock Model');
  await expect(page.getByRole('img', { name: '1 of 6 roles ready' })).toBeVisible();
  await page.getByRole('button', { name: 'Fill empty roles' }).click();
  await expect(page.getByRole('heading', { name: 'Your team is ready' })).toBeVisible();
  await expect(page.getByRole('img', { name: '6 of 6 roles ready' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Default model for Orchestrator (Sovereign)', exact: true })).toContainText('Mock Model');
  await page.reload();
  await page.getByRole('tab', { name: 'Role defaults' }).click();
  await expect(page.getByRole('img', { name: '6 of 6 roles ready' })).toBeVisible();
  await go(page, 'Workspace');
  await expect(page.getByText('Pick a model for Sovereign to start.')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Settings follows system appearance, persists explicit choices, saves QA and confirms permissions', async ({ page }) => {
  const errors = trapErrors(page);
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await mockProvider(page);
  await page.goto('/');
  await go(page, 'Settings');
  const theme = page.getByRole('tablist', { name: 'Theme', exact: true });
  await expect(theme.getByRole('tab', { name: 'System', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await theme.getByRole('tab', { name: 'Light', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(theme.getByRole('tab', { name: 'Light', exact: true })).toHaveAttribute('aria-selected', 'true');
  await theme.getByRole('tab', { name: 'Dark', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await theme.getByRole('tab', { name: 'System', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  const nav = page.getByRole('navigation', { name: 'Settings sections' });
  await nav.getByRole('button', { name: 'QA verification' }).click();
  const qa = page.getByRole('region', { name: 'QA verification' });
  await qa.getByRole('textbox').fill('npm test');
  await qa.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(qa.getByRole('status')).toHaveText('Saved');
  await page.reload();
  await expect(qa.getByRole('textbox')).toHaveValue('npm test');
  await page.getByRole('radio', { name: /Full access/ }).click();
  const dialog = page.getByRole('dialog', { name: /Turn on full access/ });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('radio', { name: /Ask every time/ })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: /Auto-apply changes/ }).click();
  await page.getByRole('button', { name: 'Turn on auto-apply' }).click();
  await expect(page.getByRole('radio', { name: /Auto-apply changes/ })).toHaveAttribute('aria-checked', 'true');
  expect(errors).toEqual([]);
});

test('editor saves with button and keyboard, reverts, switches tabs and survives sidebar collapse', async ({ page }) => {
  const errors = trapErrors(page);
  await mockProvider(page);
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Search files', exact: true }).fill('greeting');
  await page.getByRole('treeitem').filter({ hasText: 'src/greeting.ts' }).click();
  const editor = page.getByRole('textbox', { name: 'Editing src/greeting.ts', exact: true });
  const original = FIXTURE_FILES['src/greeting.ts'];
  await editor.fill(original + '// saved with button\n');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => fs.readFileSync(path.join(E2E_WORKSPACE, 'src/greeting.ts'), 'utf8')).toContain('saved with button');
  await editor.fill(original + '// saved with keyboard\n');
  await editor.press('ControlOrMeta+s');
  await expect.poll(() => fs.readFileSync(path.join(E2E_WORKSPACE, 'src/greeting.ts'), 'utf8')).toContain('saved with keyboard');
  await editor.fill('discard this edit');
  await page.getByRole('button', { name: 'Revert', exact: true }).click();
  await expect(editor).toHaveValue(original + '// saved with keyboard\n');
  await page.getByRole('textbox', { name: 'Search files', exact: true }).fill('math');
  await page.getByRole('treeitem').filter({ hasText: 'src/math.ts' }).click();
  await page.getByRole('tab', { name: 'greeting.ts', exact: true }).click();
  await expect(editor).toBeVisible();
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
  await go(page, 'Tasks');
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toContainText('Tasks');
  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await go(page, 'Workspace');
  await page.getByRole('button', { name: 'Close src/math.ts', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'math.ts', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('install helpers and system terminal send the intended requests without running installers', async ({ page }) => {
  const errors = trapErrors(page);
  const bodies: unknown[] = [];
  await mockProvider(page);
  await page.route('**/api/workspace/open-terminal', async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true, terminal: 'mock-terminal', cwd: E2E_WORKSPACE, command: null } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open in external terminal app', exact: true }).click();
  await expect.poll(() => bodies).toEqual([{}]);
  await go(page, 'Connections');
  const row = page.getByRole('row').filter({ hasText: 'npm i -g @google/gemini-cli' });
  await row.getByRole('button', { name: 'Install', exact: true }).click();
  await expect.poll(() => bodies).toEqual([{}, { install: 'gemini' }]);
  await expect(row.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', 'https://github.com/google-gemini/gemini-cli');
  expect(errors).toEqual([]);
});

test('failed lazy view offers a reload that preserves saved data', async ({ page }) => {
  await mockProvider(page);
  const chunk = /\/(?:assets\/TasksView[^/?]*\.js|src\/components\/tasks\/TasksView\.tsx)(?:\?|$)/;
  await page.route(chunk, (route) => route.abort('failed'));
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('agent-hq.recovery-test', 'keep this'));
  await go(page, 'Tasks');
  await expect(page.getByRole('heading', { name: 'Reload to load this view' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear saved browser data' })).toHaveCount(0);
  await page.unroute(chunk);
  await page.getByRole('button', { name: 'Reload app' }).click();
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toContainText('Tasks');
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('agent-hq.recovery-test'))).toBe('keep this');
});

test('project picker overlays the full app, traps focus and opens or creates projects', async ({ page }, testInfo) => {
  const errors = trapErrors(page);
  await mockProvider(page);
  let workspace = E2E_WORKSPACE;
  const parent = path.dirname(workspace);
  const selected = path.join(parent, 'selected-project');
  const calls: Array<{ kind: string; body: Record<string, unknown> }> = [];
  await page.route('**/api/workspace', (route) => route.fulfill({
    json: { ok: true, root: workspace, name: path.basename(workspace), lockedByEnv: false, recent: [] },
  }));
  await page.route('**/api/fs/browse**', (route) => route.fulfill({
    json: { ok: true, path: parent, parent: path.dirname(parent), home: parent, dirs: [{ name: 'selected-project', path: selected, isProject: true }], truncated: false },
  }));
  await page.route('**/api/workspace/root', async (route) => {
    const body = route.request().postDataJSON();
    calls.push({ kind: 'open', body });
    workspace = body.path;
    await route.fulfill({ json: { ok: true, root: workspace, name: path.basename(workspace) } });
  });
  await page.route('**/api/workspace/create', async (route) => {
    const body = route.request().postDataJSON();
    calls.push({ kind: 'create', body });
    workspace = path.join(body.parent, body.name);
    await route.fulfill({ json: { ok: true, root: workspace, name: body.name, git: 'initialized' } });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const trigger = page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: /demo-app/ });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Project', exact: true });
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds!.width).toBeGreaterThan(600);
  expect(Math.abs(bounds!.x + bounds!.width / 2 - 720)).toBeLessThan(2);
  expect(await dialog.evaluate((node) => node.parentElement?.parentElement === document.body)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('project-picker.png') });
  await dialog.getByRole('button', { name: /^Open “/ }).focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: /^Open “/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await page.getByRole('button', { name: 'Switch project', exact: true }).click();
  expect((await dialog.boundingBox())!.width).toBeGreaterThan(600);
  await dialog.getByRole('option', { name: /selected-project/ }).getByRole('button').first().click();
  await dialog.getByRole('button', { name: 'Open “selected-project”', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(calls[0]).toEqual({ kind: 'open', body: { path: selected } });
  await page.getByRole('button', { name: 'Switch project', exact: true }).click();
  await dialog.getByRole('tab', { name: 'New project' }).click();
  await dialog.getByRole('textbox', { name: 'Project name', exact: true }).fill('new-project');
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(calls[1]).toEqual({ kind: 'create', body: { parent, name: 'new-project', gitInit: true, description: '' } });
  expect(errors).toEqual([]);
});

for (const width of [1000, 1440]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`updated pages fit ${width}px in ${theme} theme with reduced motion`, async ({ page }, testInfo) => {
      const errors = trapErrors(page);
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await mockProvider(page);
      await page.goto('/');
      await go(page, 'Connections');
      await page.getByRole('tab', { name: 'Role defaults' }).click();
      await expect(page.getByRole('heading', { name: 'Choose a model for each role' })).toBeVisible();
      await expect(page.getByRole('button', { name: /^Default model for/ })).toHaveCount(6);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('role-defaults.png') });
      await go(page, 'Settings');
      await expect(page.getByRole('heading', { name: 'Project', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Keyboard shortcuts', exact: true })).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('settings.png') });
      await go(page, 'Agents');
      await page.getByRole('tab', { name: 'Office', exact: true }).click();
      await expect(page.getByRole('img', { name: 'Office floor plan' })).toBeVisible();
      for (const lighting of ['Day', 'Night', 'Auto']) {
        await page.getByRole('radio', { name: lighting, exact: true }).click();
        await expect(page.getByRole('radio', { name: lighting, exact: true })).toHaveAttribute('aria-checked', 'true');
      }
      expect(errors).toEqual([]);
    });
  }
}

test('typing in the project dialog filters folders and Enter goes into the match', async ({ page }) => {
  const errors = trapErrors(page);
  const parent = path.dirname(E2E_WORKSPACE);
  for (const name of ['alpha-lib', 'beta-app', 'alpine-notes']) fs.mkdirSync(path.join(parent, name), { recursive: true });
  await mockProvider(page);
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: /demo-app/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Project', exact: true });
  const folders = dialog.getByRole('listbox', { name: 'Folders' });
  await expect(dialog.getByRole('textbox', { name: 'Filter folders' })).toBeFocused();
  await expect(folders.getByRole('option')).toHaveCount(4);
  await page.keyboard.type('alp');
  await expect(folders.getByRole('option')).toHaveCount(2);
  await expect(folders).not.toContainText('beta-app');
  await page.keyboard.type('ine');
  await expect(folders.getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('textbox', { name: 'Folder path' })).toHaveValue(path.join(parent, 'alpine-notes'));
  await expect(dialog.getByRole('textbox', { name: 'Filter folders' })).toHaveValue('');
  await page.keyboard.press('Backspace');
  await expect(dialog.getByRole('textbox', { name: 'Folder path' })).toHaveValue(parent);
  await page.keyboard.type('zzz');
  await expect(folders).toContainText('No folder matches');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Filter folders' })).toHaveValue('');
  expect(errors).toEqual([]);
});

test('opening the workspace with the Changes tab saved and no mission does not crash', async ({ page }) => {
  const errors = trapErrors(page);
  await mockProvider(page);
  await page.addInitScript(() => localStorage.setItem('agent-hq.layout', JSON.stringify({ state: { bottomTab: 'changes', bottomVisible: true }, version: 0 })));
  await page.goto('/');
  await expect(page.getByText(/failed to render/i)).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Changes' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Terminal', exact: true }).click();
  await expect(page.getByTestId('integrated-terminal')).toBeVisible();
  expect(errors).toEqual([]);
});
