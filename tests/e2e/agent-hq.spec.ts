import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';
import { E2E_WORKSPACE, FIXTURE_FILES, resetFixtureWorkspace } from './fixture';
import { mockProvider, pick, trapErrors } from './mocks';

test.beforeEach(() => resetFixtureWorkspace());

test('every view opens without errors', async ({ page }) => {
  const errors = trapErrors(page);
  await mockProvider(page);
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  for (const view of ['Workspace', 'Agents', 'Tasks', 'Reports', 'Connections', 'Settings']) {
    await nav.getByRole('button', { name: view, exact: true }).click();
    await expect(page.getByRole('main')).toHaveAttribute('aria-label', view.toLowerCase());
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
    if (view !== 'Workspace') await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toContainText(view);
  }
  await page.keyboard.press('Alt+2');
  await expect(page.getByRole('main')).toHaveAttribute('aria-label', 'agents');
  expect(errors).toEqual([]);
});

test('agent command runner runs allow-listed commands and refuses shell syntax', async ({ page }) => {
  const errors = trapErrors(page);
  await mockProvider(page);
  await page.goto('/');
  await page.getByRole('tab', { name: 'Agent commands' }).click();
  const input = page.getByRole('textbox', { name: 'Terminal command' });
  await input.fill('ls src');
  await input.press('Enter');
  await expect(page.getByText('greeting.ts')).toBeVisible();
  await input.fill('ls; cat /etc/passwd');
  await input.press('Enter');
  await expect(page.getByText(/Shell operators, globs, and substitutions are not allowed/)).toBeVisible();
  await input.fill('git diff --output=x.txt');
  await input.press('Enter');
  await expect(page.getByText(/option is not allowed in the terminal/)).toBeVisible();
  expect(errors).toEqual([]);
});

test('plan, approve and run: parallel waves, file context, QA and applying a change', async ({ page }) => {
  const errors = trapErrors(page);
  const calls = await mockProvider(page);
  await page.goto('/');

  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByRole('tab', { name: 'Role defaults' }).click();
  await page.getByRole('button', { name: 'Fill empty roles' }).click();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Workspace', exact: true }).click();

  await page.getByRole('tab', { name: 'Plan' }).click();
  await pick(page, 'Team strategy', 'Only use my existing agents');
  await page.getByRole('button', { name: 'Attach a project file' }).click();
  await page.getByRole('textbox', { name: 'Search files to attach' }).fill('README');
  await page.getByRole('button', { name: 'README.md', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message Sovereign' }).fill('Greet the user and add subtraction.');
  await page.getByRole('button', { name: 'Send' }).click();

  await expect(page.getByText('Proposed plan · 3 tasks')).toBeVisible();
  await page.getByRole('button', { name: 'Approve & run' }).click();
  await expect(page.getByText(/Run completed and approved by QA\. 3 proposed file change/)).toBeVisible({ timeout: 30_000 });

  const task = (title: string) => calls.find((c) => c.kind === 'task' && c.task === title)!;
  const [t1, t2, t3] = [task('Update greeting'), task('Add subtract helper'), task('Document the changes')];
  expect(t1 && t2 && t3).toBeTruthy();
  expect(Math.max(t1.start, t2.start), 'independent tasks should overlap').toBeLessThan(Math.min(t1.end, t2.end));
  expect(t3.start, 'dependent task waits for both dependencies').toBeGreaterThanOrEqual(Math.max(t1.end, t2.end));
  expect(calls.filter((c) => c.kind === 'qa')).toHaveLength(1);

  expect(t1.user, 'task receives the file its description names').toContain('GREETING-MARKER');
  for (const t of [t1, t2, t3]) expect(t.user, 'every task receives the attached file').toContain('README-MARKER');
  expect(t3.user).toContain('Output of "Update greeting"');

  await page.getByRole('tab', { name: /Changes/ }).click();
  const row = page.locator('div', { has: page.getByText('src/greeting.ts', { exact: true }) }).filter({ has: page.getByRole('button', { name: 'Apply' }) }).last();
  await row.getByRole('button', { name: 'Apply' }).click();
  await expect(row.getByText('applied')).toBeVisible();
  await expect.poll(() => fs.readFileSync(path.join(E2E_WORKSPACE, 'src/greeting.ts'), 'utf8')).toContain('Hello, user');
  expect(fs.readFileSync(path.join(E2E_WORKSPACE, 'src/math.ts'), 'utf8'), 'unapplied changes are not written').not.toContain('subtract');

  expect(errors).toEqual([]);
});

test('full access: runs without plan approval, auto-applies QA-approved changes, and undo restores files', async ({ page }) => {
  const errors = trapErrors(page);
  await mockProvider(page, 200);
  await page.goto('/');

  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByRole('tab', { name: 'Role defaults' }).click();
  await page.getByRole('button', { name: 'Fill empty roles' }).click();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Workspace', exact: true }).click();

  await page.getByRole('tab', { name: 'Build' }).click();
  await pick(page, 'Team strategy', 'Only use my existing agents');
  await pick(page, 'Approval mode', 'Full access');
  const confirm = page.getByRole('dialog', { name: /Turn on full access/ });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Allow full access' }).click();
  await expect(page.getByTestId('approval-mode-badge')).toHaveText('Full access');

  await page.getByRole('textbox', { name: 'Message Sovereign' }).fill('Greet the user and add subtraction.');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Full access is on: running the plan without waiting for approval.')).toBeVisible();
  await expect(page.getByText(/Auto mode wrote 3 file\(s\) to the project\./)).toBeVisible({ timeout: 30_000 });

  const read = (rel: string) => fs.readFileSync(path.join(E2E_WORKSPACE, rel), 'utf8');
  expect(read('src/greeting.ts')).toContain('Hello, user');
  expect(read('src/math.ts')).toContain('subtract');
  expect(read('docs/CHANGES.md')).toContain('# Changes');

  await page.getByRole('tab', { name: /Changes/ }).click();
  const row = (file: string) => page.locator('div', { has: page.getByText(file, { exact: true }) }).filter({ has: page.getByRole('button', { name: 'Undo' }) }).last();
  await row('src/math.ts').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => read('src/math.ts')).toBe(FIXTURE_FILES['src/math.ts']);
  await row('docs/CHANGES.md').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => fs.existsSync(path.join(E2E_WORKSPACE, 'docs/CHANGES.md'))).toBe(false);
  expect(read('src/greeting.ts'), 'other changes stay applied').toContain('Hello, user');
  await expect(page.getByText('reverted', { exact: true })).toHaveCount(2);

  expect(errors).toEqual([]);
});
