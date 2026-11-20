import path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { resetFixtureWorkspace } from './fixture';
import { mockProvider, pick } from './mocks';

/** Regenerates the README screenshots from a scripted run: AGENT_HQ_SCREENSHOTS=1 npm run test:e2e -- screenshots */
const OUT = path.resolve('docs/screenshots');

test.skip(!process.env.AGENT_HQ_SCREENSHOTS, 'Set AGENT_HQ_SCREENSHOTS=1 to regenerate docs/screenshots.');
test.use({ viewport: { width: 1600, height: 960 } });

const shot = (page: Page, name: string) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

test('capture README screenshots', async ({ page }) => {
  test.setTimeout(120_000);
  resetFixtureWorkspace();
  await mockProvider(page, 3500, { magpie: true });
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  const go = (view: string) => nav.getByRole('button', { name: view, exact: true }).click();

  await go('Connections');
  await page.waitForTimeout(400);
  await shot(page, 'connections');
  await page.getByRole('tab', { name: 'Role defaults' }).click();
  await page.waitForTimeout(300);
  await shot(page, 'role-defaults');
  await page.getByRole('button', { name: 'Fill empty roles' }).click();
  await go('Workspace');

  await page.getByRole('tab', { name: 'Plan' }).click();
  await pick(page, 'Team strategy', 'Only use my existing agents');
  await page.getByRole('textbox', { name: 'Message Sovereign' }).fill('Greet the user by name and add a subtract helper next to add.');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Proposed plan · 3 tasks')).toBeVisible();
  await page.getByRole('button', { name: 'Approve & run' }).click();

  await expect(page.getByText(/Update greeting/).first()).toBeVisible();
  await page.waitForTimeout(1200);
  await go('Tasks');
  await page.waitForTimeout(500);
  await shot(page, 'tasks');
  await go('Agents');
  await page.getByRole('tab', { name: 'Graph' }).click();
  await page.waitForTimeout(900);
  await shot(page, 'agents');
  await page.getByRole('tab', { name: 'Office' }).click();
  await page.waitForTimeout(900);
  await shot(page, 'office');
  await page.getByRole('radio', { name: 'Day' }).click();
  await page.waitForTimeout(1200);
  await shot(page, 'office-day');
  await page.getByRole('radio', { name: 'Auto' }).click();
  await page.getByRole('tab', { name: 'Graph' }).click();

  await go('Workspace');
  await expect(page.getByText(/Run completed and approved by QA/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('tab', { name: /Changes/ }).click();
  await page.getByRole('button', { name: 'Diff' }).first().click();
  await page.waitForTimeout(400);
  await shot(page, 'workspace');

  await go('Reports');
  await page.waitForTimeout(500);
  await shot(page, 'reports');

  await go('Settings');
  await page.getByRole('radio', { name: /Auto-apply changes/ }).click();
  await page.getByRole('button', { name: 'Turn on auto-apply' }).click();
  await page.waitForTimeout(300);
  await shot(page, 'settings');

  await nav.getByRole('button', { name: 'Light theme' }).click();
  await go('Workspace');
  await page.waitForTimeout(400);
  await shot(page, 'workspace-light');
  await page.getByRole('button', { name: /Collapse/ }).click();
  await page.waitForTimeout(600);
  await shot(page, 'workspace-collapsed');
});
