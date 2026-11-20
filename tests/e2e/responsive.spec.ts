import { expect, test, type Page } from '@playwright/test';
import { resetFixtureWorkspace } from './fixture';
import { auditLayout, stressText, type LayoutIssue } from './layoutAudit';
import { mockProvider, pick, trapErrors } from './mocks';

const nav = (page: Page, view: string) =>
  page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: view, exact: true }).click();

async function closeOverlays(page: Page) {
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('Escape');
}

const LONG_AGENT = 'Embedded Firmware And Over-The-Air Update Reliability Specialist';

const toggleSidebar = (page: Page) => page.getByRole('button', { name: /(Collapse|Expand) sidebar/ }).click();

const SCREENS: Array<{ name: string; open: (page: Page) => Promise<unknown>; close?: (page: Page) => Promise<unknown> }> = [
  { name: 'workspace', open: (p) => nav(p, 'Workspace') },
  { name: 'workspace changes', open: async (p) => { await nav(p, 'Workspace'); await p.getByRole('tab', { name: /Changes/ }).click(); } },
  { name: 'agents list', open: async (p) => { await nav(p, 'Agents'); await p.getByRole('tab', { name: 'List', exact: true }).click(); } },
  { name: 'agent details', open: async (p) => { await nav(p, 'Agents'); await p.getByRole('tab', { name: 'List', exact: true }).click(); await p.getByRole('button', { name: 'Configure Pulse', exact: true }).click(); } },
  { name: 'agents graph', open: async (p) => { await nav(p, 'Agents'); await p.getByRole('tab', { name: 'Graph', exact: true }).click(); } },
  { name: 'agents office', open: async (p) => { await nav(p, 'Agents'); await p.getByRole('tab', { name: 'Office', exact: true }).click(); } },
  { name: 'tasks', open: (p) => nav(p, 'Tasks') },
  { name: 'reports', open: (p) => nav(p, 'Reports') },
  { name: 'growth', open: (p) => nav(p, 'Growth') },
  { name: 'providers', open: async (p) => { await nav(p, 'Connections'); await p.getByRole('tab', { name: 'Providers' }).click(); } },
  { name: 'models', open: async (p) => { await nav(p, 'Connections'); await p.getByRole('tab', { name: 'Models' }).click(); } },
  { name: 'role defaults', open: async (p) => { await nav(p, 'Connections'); await p.getByRole('tab', { name: 'Role defaults' }).click(); } },
  { name: 'settings', open: (p) => nav(p, 'Settings') },
  { name: 'editor with a file', open: async (p) => { await nav(p, 'Workspace'); await p.getByRole('treeitem', { name: 'README.md', exact: true }).click(); } },
  { name: 'task detail', open: async (p) => { await nav(p, 'Tasks'); await p.locator('main section[aria-label] button').first().click(); } },
  { name: 'project switcher', open: async (p) => { await nav(p, 'Workspace'); await p.evaluate(() => window.dispatchEvent(new Event('agent-hq:open-project'))); } },
  { name: 'connection wizard', open: async (p) => { await nav(p, 'Connections'); await p.getByRole('button', { name: 'Connect provider' }).click(); } },
  { name: 'add agent dialog', open: async (p) => { await nav(p, 'Agents'); await p.getByRole('button', { name: 'Add agent' }).first().click(); } },
  { name: 'collapsed sidebar', open: async (p) => { await nav(p, 'Agents'); await toggleSidebar(p); }, close: toggleSidebar },
  { name: 'activity', open: async (p) => { await nav(p, 'Workspace'); await p.getByRole('button', { name: /Activity/ }).first().click(); } },
  { name: 'command palette', open: async (p) => { await nav(p, 'Workspace'); await p.keyboard.press('Control+k'); } },
];

async function addLongAgent(page: Page) {
  await nav(page, 'Agents');
  await page.getByRole('button', { name: 'Add agent' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add agent' });
  await dialog.getByRole('textbox').first().fill(LONG_AGENT);
  await dialog.getByRole('button', { name: 'Add agent' }).click();
  await expect(dialog).toBeHidden();
}

async function seedRun(page: Page) {
  await addLongAgent(page);
  await nav(page, 'Connections');
  await page.getByRole('tab', { name: 'Role defaults' }).click();
  await page.getByRole('button', { name: 'Fill empty roles' }).click();
  await nav(page, 'Workspace');
  await page.getByRole('tab', { name: 'Plan' }).click();
  await pick(page, 'Team strategy', 'Only use my existing agents');
  await page.getByRole('textbox', { name: 'Message Sovereign' }).fill('Greet the user and add subtraction.');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByRole('button', { name: 'Approve & run' }).click();
  await expect(page.getByText(/Run completed/)).toBeVisible({ timeout: 30_000 });
}

test.beforeEach(() => resetFixtureWorkspace());

test('every screen keeps single-line text on one line, ellipsised, at every window width', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const errors = trapErrors(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockProvider(page, 50, { magpie: true });
  await page.request.post('/api/memory/lessons', {
    data: {
      lessons: [
        { agentId: 'agent-frontend', kind: 'pitfall', pinned: true, text: `${LONG_AGENT} should never rename exported components without updating every import in the project first.` },
        { agentId: 'team', kind: 'convention', text: 'UnbreakableIdentifier_'.repeat(8) },
        { agentId: 'agent-frontend', kind: 'decision', text: 'Short lesson.' },
      ],
    },
  });
  await page.goto('/');
  await seedRun(page);
  const found: Array<LayoutIssue & { screen: string; width: number; stress: boolean }> = [];
  for (const width of [880, 1024, 1280, 1920]) {
    await page.setViewportSize({ width, height: 760 });
    for (const stress of [false, true]) {
      for (const screen of SCREENS) {
        await closeOverlays(page);
        await screen.open(page);
        await expect(page.locator('[data-view-loading]')).toHaveCount(0);
        await stressText(page, stress);
        await page.waitForTimeout(60);
        for (const issue of await auditLayout(page)) found.push({ ...issue, screen: screen.name, width, stress });
        if (width <= 1024) await page.screenshot({ path: testInfo.outputPath(`${screen.name.replace(/ /g, '-')}-${width}${stress ? '-stress' : ''}.png`) });
        await stressText(page, false);
        if (screen.close) await screen.close(page);
      }
    }
  }
  const report = found.map((i) => `${i.width}${i.stress ? ' stress' : ''} | ${i.screen} | ${i.kind} | ${i.text} | ${i.where}`);
  console.log(report.join('\n'));
  expect(report).toEqual([]);
  expect(errors).toEqual([]);
});

test.describe('overflow tooltip', () => {
  const tooltip = (page: Page) => page.locator('[data-overflow-tooltip]');
  const longName = (page: Page) => page.locator('tbody tr').filter({ hasText: LONG_AGENT }).getByText(LONG_AGENT, { exact: true });

  test.beforeEach(async ({ page }) => {
    await mockProvider(page, 50, { magpie: true });
    await page.setViewportSize({ width: 1024, height: 760 });
    await page.goto('/');
    await addLongAgent(page);
    await page.getByRole('tab', { name: 'List', exact: true }).click();
  });

  test('shows the full text only when the text is cut off', async ({ page }) => {
    const name = longName(page);
    await expect(name).toHaveCSS('text-overflow', 'ellipsis');
    expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await name.hover();
    await expect(tooltip(page)).toHaveText(LONG_AGENT);
    await page.mouse.move(2, 400);
    await expect(tooltip(page)).toHaveCount(0);

    const short = page.locator('tbody tr').filter({ hasText: 'Pulse' }).getByText('Pulse', { exact: true });
    await short.hover();
    await page.waitForTimeout(700);
    await expect(tooltip(page)).toHaveCount(0);
  });

  test('opens on keyboard focus, closes on Escape and stays inside the window', async ({ page }) => {
    await page.locator('tbody tr').filter({ hasText: LONG_AGENT }).scrollIntoViewIfNeeded();
    await page.locator('tbody tr').filter({ hasText: LONG_AGENT }).focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(page.locator('tbody tr').filter({ hasText: LONG_AGENT })).toBeFocused();
    await expect(tooltip(page)).toHaveText(LONG_AGENT);
    const box = await tooltip(page).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(1024);
    await page.keyboard.press('Escape');
    await expect(tooltip(page)).toHaveCount(0);
  });

  test('truncation follows the window size without a reload', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 760 });
    await nav(page, 'Connections');
    await page.getByRole('tab', { name: 'Providers' }).click();
    const marked = await page.evaluate(() => {
      const cut = Array.from(document.querySelectorAll<HTMLElement>('main td .truncate, main td.truncate')).find((el) => el.scrollWidth > el.clientWidth + 1);
      if (cut) cut.dataset.resizeProbe = '';
      return cut?.textContent ?? null;
    });
    expect(marked, 'some table cell is ellipsised at 1024px').toBeTruthy();
    const probe = page.locator('[data-resize-probe]');
    const isCut = () => probe.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    await page.setViewportSize({ width: 2560, height: 760 });
    await expect.poll(isCut).toBe(false);
    await expect(probe).toHaveText(marked!);
    await probe.hover();
    await page.waitForTimeout(700);
    await expect(tooltip(page)).toHaveCount(0);
    await page.setViewportSize({ width: 1024, height: 760 });
    await expect.poll(isCut).toBe(true);
    await probe.hover({ position: { x: 4, y: 4 } });
    await expect(tooltip(page)).toHaveText(marked!.replace(/\s+/g, ' ').trim());
  });
});
