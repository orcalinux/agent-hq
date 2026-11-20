import fs from 'fs';
import path from 'path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { E2E_WORKSPACE, resetFixtureWorkspace } from './fixture';
import { mockProvider, trapErrors } from './mocks';

test.describe.configure({ mode: 'serial' });

const closeAllSessions = async (request: APIRequestContext) => {
  const { sessions } = await (await request.get('/api/terminal/sessions')).json();
  for (const session of sessions) await request.post('/api/terminal/close', { data: { id: session.id } });
};

test.beforeEach(async ({ request }) => {
  await closeAllSessions(request);
  resetFixtureWorkspace();
});

test.afterEach(({ request }) => closeAllSessions(request));

const screen = (page: Page) => page.locator('[data-testid="integrated-terminal"] .xterm-rows');
const typeLine = async (page: Page, text: string) => {
  await page.locator('[data-testid="integrated-terminal"] .xterm-helper-textarea').focus();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
};

test('integrated terminal is a real shell in the project folder with tabs, resize and cleanup', async ({ page, request }) => {
  const errors = trapErrors(page);
  await mockProvider(page);
  await page.goto('/');
  const terminal = page.getByTestId('integrated-terminal');
  await expect(terminal.getByRole('tab')).toHaveCount(1);

  await typeLine(page, 'pwd');
  await expect(screen(page)).toContainText(E2E_WORKSPACE);

  await typeLine(page, 'echo $((6*7))-ok && printf "\\033[31mred\\033[0m\\n"');
  await expect(screen(page)).toContainText('42-ok');

  await typeLine(page, 'echo from-first > from-terminal.txt');
  await expect.poll(() => fs.existsSync(path.join(E2E_WORKSPACE, 'from-terminal.txt'))).toBe(true);

  await typeLine(page, 'sleep 30');
  await page.keyboard.press('Control+C');
  await typeLine(page, 'echo after-interrupt');
  await expect(screen(page)).toContainText('after-interrupt');

  await terminal.getByRole('button', { name: 'New terminal' }).click();
  await expect(terminal.getByRole('tab')).toHaveCount(2);
  await typeLine(page, 'echo second-shell');
  await expect(screen(page)).toContainText('second-shell');
  await expect(screen(page)).not.toContainText('after-interrupt');

  await terminal.getByRole('tab').first().click();
  await expect(screen(page)).toContainText('after-interrupt');

  const before = await page.evaluate(() => document.querySelector('.xterm-screen')!.getBoundingClientRect().width);
  await page.setViewportSize({ width: 1150, height: 700 });
  await expect.poll(() => page.evaluate(() => document.querySelector('.xterm-screen')!.getBoundingClientRect().width)).toBeLessThan(before);

  await page.getByRole('tab', { name: 'Agent commands' }).click();
  await page.getByRole('tab', { name: 'Terminal', exact: true }).click();
  await expect(screen(page)).toContainText('after-interrupt');

  await page.reload();
  await expect(terminal.getByRole('tab')).toHaveCount(2);
  await expect(screen(page)).toContainText('after-interrupt');

  await typeLine(page, 'exit 0');
  await expect(terminal.getByText(/Process exited with code 0/)).toBeVisible();
  await terminal.getByRole('button', { name: 'Restart' }).click();
  await expect(terminal.getByText(/Process exited/)).toHaveCount(0);

  for (let remaining = 2; remaining > 0; remaining--) {
    await terminal.getByRole('button', { name: /^Close terminal/ }).first().click();
    await expect(terminal.getByRole('tab')).toHaveCount(remaining - 1);
  }
  await expect(terminal.getByRole('tab')).toHaveCount(0);
  await expect(terminal.getByText('No terminal is open')).toBeVisible();
  const list = await request.get('/api/terminal/sessions');
  expect((await list.json()).sessions).toEqual([]);
  expect(errors).toEqual([]);
});

test('terminal API only accepts JSON requests from this machine and bounded input', async ({ request }) => {
  const rejected = await request.post('/api/terminal/sessions', { headers: { 'content-type': 'text/plain' }, data: '{}' });
  expect(rejected.status()).toBe(415);
  const missing = await request.post('/api/terminal/input', { data: { id: 'nope', data: 'ls\n' } });
  expect(missing.status()).toBe(404);
  const created = await request.post('/api/terminal/sessions', { data: { cols: 99999, rows: -4 } });
  expect(created.ok()).toBe(true);
  const { session } = await created.json();
  expect(session.cwd).toBe(E2E_WORKSPACE);
  const big = await request.post('/api/terminal/input', { data: { id: session.id, data: 'x'.repeat(70000) } });
  expect(big.status()).toBe(413);
  await request.post('/api/terminal/close', { data: { id: session.id } });
});

test('Ctrl+` opens the terminal and shell keys are not hijacked', async ({ page }) => {
  await mockProvider(page);
  await page.goto('/');
  await page.getByRole('tab', { name: 'Problems' }).click();
  await page.keyboard.press('Control+`');
  await expect(page.getByTestId('integrated-terminal')).toBeVisible();
  await typeLine(page, 'echo keys');
  await page.keyboard.press('Control+B');
  await expect(page.getByRole('button', { name: 'Toggle explorer (Ctrl+B)' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Control+L');
  await expect(page.locator('#orchestrator-input')).not.toBeFocused();
});
