import path from 'path';
import { expect, test } from '@playwright/test';
import { resetFixtureWorkspace } from './fixture';
import { mockProvider, pick } from './mocks';

/** Regenerates the README screenshots from a scripted run: AGENT_HQ_SCREENSHOTS=1 npm run test:e2e -- screenshots */
const OUT = path.resolve('docs/screenshots');

test.skip(!process.env.AGENT_HQ_SCREENSHOTS, 'Set AGENT_HQ_SCREENSHOTS=1 to regenerate docs/screenshots.');
test.use({ viewport: { width: 1600, height: 960 } });

test('capture README screenshots', async ({ page }) => {
  resetFixtureWorkspace();
  await mockProvider(page, 3500);
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await nav.getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByRole('tab', { name: 'Role defaults' }).click();
  await page.getByRole('button', { name: 'Fill empty roles' }).click();
  await nav.getByRole('button', { name: 'Workspace', exact: true }).click();

  await page.getByRole('tab', { name: 'Plan' }).click();
  await pick(page, 'Team strategy', 'Only use my existing agents');
  await page.getByRole('textbox', { name: 'Message Sovereign' }).fill('Greet the user by name and add a subtract helper next to add.');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Proposed plan · 3 tasks')).toBeVisible();
  await page.getByRole('button', { name: 'Approve & run' }).click();

  await expect(page.getByText(/Update greeting/).first()).toBeVisible();
  await page.waitForTimeout(1200);
  await nav.getByRole('button', { name: 'Tasks', exact: true }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'tasks.png') });
  await nav.getByRole('button', { name: 'Agents', exact: true }).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, 'agents.png') });
  await nav.getByRole('button', { name: 'Workspace', exact: true }).click();
  await expect(page.getByText(/Run completed and approved by QA/)).toBeVisible({ timeout: 30_000 });

  await page.getByRole('tab', { name: /Changes/ }).click();
  await page.getByRole('button', { name: 'Diff' }).first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'workspace.png') });
});
