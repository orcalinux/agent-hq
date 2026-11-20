import fs from 'fs';
import path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { E2E_WORKSPACE, resetFixtureWorkspace } from './fixture';
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

const DEMO_LESSONS: Array<[string, string, string, number, number, number]> = [
  ['agent-frontend', 'convention', 'Style buttons with Tailwind classes from the shared tokens, never inline styles.', 2, 6, 49],
  ['agent-frontend', 'pitfall', 'Tailwind tokens for buttons live in src/styles/globals.css; check both themes.', 1, 4, 30],
  ['agent-frontend', 'decision', 'Dialogs reuse the shared Dialog component so motion and focus trapping stay consistent.', 0, 3, 17],
  ['agent-frontend', 'preference', 'Keep component files under 300 lines and split dialogs out of views.', 0, 1, 3],
  ['agent-backend', 'fact', 'Database migrations live in db/migrations and run before seeding the database.', 1, 3, 40],
  ['agent-backend', 'pitfall', 'Validate request bodies at the API boundary; the database layer trusts its input.', 0, 2, 12],
  ['agent-backend', 'convention', 'Every new migration needs a matching down migration.', 0, 1, 2],
  ['agent-qa', 'pitfall', 'Run the verification command after every rework, not only on the first pass.', 2, 5, 22],
  ['agent-qa', 'convention', 'Reject changes that add a dependency without a lockfile update.', 0, 2, 9],
  ['agent-architect', 'decision', 'State lives in small zustand stores per feature; no global store.', 1, 4, 35],
  ['agent-intern-1', 'pitfall', 'Ask Pulse before changing shared Tailwind tokens.', 0, 1, 5],
  ['team', 'preference', 'Keep commit messages short and in the imperative.', 0, 7, 44],
];

test('capture Growth screenshot', async ({ page }) => {
  resetFixtureWorkspace();
  const now = Date.now();
  const day = 24 * 3600 * 1000;
  const sources = ['qa', 'reflection', 'mentor', 'user'];
  const lessons = DEMO_LESSONS.map(([agentId, kind, text, reinforced, uses, daysAgo], i) => ({
    id: `demo-${i}`, agentId, kind, text, source: sources[i % sources.length],
    createdAt: now - daysAgo * day, updatedAt: now - Math.max(0, daysAgo - 1) * day, reinforced, uses,
  }));
  fs.mkdirSync(path.join(E2E_WORKSPACE, '.agent-hq/memory'), { recursive: true });
  fs.writeFileSync(path.join(E2E_WORKSPACE, '.agent-hq/memory/lessons.json'), JSON.stringify({ version: 1, lessons }));
  await mockProvider(page, 50, { magpie: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Growth', exact: true }).click();
  await expect(page.getByTestId('growth-card').first()).toHaveAttribute('aria-label', 'Pulse growth');
  await page.waitForTimeout(600);
  await shot(page, 'growth');
});
