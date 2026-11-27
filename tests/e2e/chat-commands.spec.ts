import { expect, test } from '@playwright/test';
import { mockProvider, pick } from './mocks';

test('/plan switches mode from the keyboard, with option menus and no model needed', async ({ page }) => {
  const modelRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/chat') modelRequests.push(request.url());
  });
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Message Sovereign' });
  const menu = page.getByTestId('chat-completions');
  const notes = page.getByTestId('chat-system-note');

  await input.fill('/pl');
  await expect(menu.getByRole('option', { name: /\/plan/ })).toHaveAttribute('aria-selected', 'true');
  await input.press('Tab');
  await expect(input).toHaveValue('/plan ');
  await input.press('Enter');
  await expect(page.getByRole('tab', { name: 'Plan' })).toHaveAttribute('aria-selected', 'true');
  await expect(notes.last()).toHaveText('Switched to Plan mode.');
  await expect(input).toHaveValue('');

  await input.fill('/team ');
  await expect(menu.getByRole('option')).toHaveCount(2);
  await menu.getByRole('option', { name: /fixed/ }).click();
  await expect(input).toHaveValue('/team fixed ');
  await input.press('Escape');
  await input.press('Enter');
  await expect(notes.last()).toHaveText('Team strategy set to fixed.');

  await input.fill('/approval full');
  await input.press('Escape');
  await input.press('Enter');
  await expect(notes.last()).toContainText('approval picker');

  await input.fill('/help');
  await input.press('Escape');
  await input.press('Enter');
  await expect(notes.last()).toContainText('/approval <ask|auto|full>');

  await input.fill('/ask');
  await input.press('Escape');
  await input.press('Enter');
  await expect(page.getByRole('tab', { name: 'Ask' })).toHaveAttribute('aria-selected', 'true');
  await input.fill('/clear');
  await input.press('Escape');
  await input.press('Enter');
  await expect(notes).toHaveCount(0);

  await input.fill('/model');
  await input.press('Escape');
  await input.press('Enter');
  await expect(notes.last()).toContainText('Sovereign model:');

  await input.fill('/btw');
  await input.press('Escape');
  await input.press('Enter');
  await expect(notes.last()).toContainText('Write a side question after /btw');

  await input.fill('/consult');
  await input.press('Escape');
  await input.press('Enter');
  await expect(notes.last()).toContainText('Name an agent to consult');

  expect(modelRequests).toEqual([]);
});

test('the attach-file popover closes on outside click, Escape and when focus leaves', async ({ page }) => {
  await page.goto('/');
  const attach = page.getByRole('button', { name: 'Attach a project file' });
  const search = page.getByRole('textbox', { name: 'Search files to attach' });
  await attach.click();
  await expect(search).toBeVisible();
  await page.getByRole('tab', { name: 'Build' }).click();
  await expect(search).toBeHidden();
  await attach.click();
  await expect(search).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(search).toBeHidden();
  await attach.click();
  await attach.click();
  await expect(search).toBeHidden();
  await attach.click();
  await page.getByRole('tab', { name: 'Plan' }).click();
  await expect(search).toBeHidden();
});

test('custom slash commands can be validated, saved in Settings, completed with /, and expanded into prompts', async ({ page }) => {
  const calls = await mockProvider(page, 10);
  await page.goto('/');
  await pick(page, 'Sovereign model', 'Mock Model');

  const nav = page.getByRole('navigation', { name: 'Primary' });
  await nav.getByRole('button', { name: 'Settings', exact: true }).click();

  const commandsSection = page.locator('#settings-commands');
  await expect(commandsSection).toBeVisible();

  const nameInput = commandsSection.getByLabel(/Command name/);
  const templateInput = commandsSection.getByLabel(/Prompt template/);
  await expect(nameInput).toHaveAttribute('aria-invalid', 'false');

  // Reserved built-in name shows validation error after interaction/submit and focuses the field.
  await nameInput.fill('plan');
  await templateInput.fill('Inspect {{input}}');
  await commandsSection.getByRole('button', { name: 'Add command' }).click();
  await expect(nameInput).toHaveAttribute('aria-invalid', 'true');
  await expect(nameInput).toBeFocused();
  await expect(commandsSection.getByText(/\/plan is a built-in command/)).toBeVisible();

  // Save a valid custom command with Plan mode and template variables.
  await nameInput.fill('audit');
  await expect(nameInput).toHaveAttribute('aria-invalid', 'false');
  await commandsSection.getByLabel('Description').fill('Security audit');
  await commandsSection.getByRole('radio', { name: 'Plan', exact: true }).check();
  await templateInput.fill('Audit {{input}} in {{project}}');
  await commandsSection.getByRole('button', { name: 'Add command' }).click();
  await expect(commandsSection.getByRole('status')).toContainText('Saved /audit');
  await expect(commandsSection.locator('code', { hasText: '/audit' })).toBeVisible();

  // Back in Workspace, /au completes /audit and sending expands the template in Plan mode.
  await nav.getByRole('button', { name: 'Workspace', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Message Sovereign' });
  const menu = page.getByTestId('chat-completions');

  await input.fill('/au');
  await expect(menu.getByRole('option', { name: /\/audit/ })).toHaveAttribute('aria-selected', 'true');
  await input.press('Tab');
  await expect(input).toHaveValue('/audit ');

  await input.fill('/audit login flow');
  await input.press('Escape');
  await input.press('Enter');

  await expect(page.getByRole('tab', { name: 'Plan' })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0].kind).toBe('plan');
  expect(calls[0].user).toMatch(/^Audit login flow in \S+/);
  // Original command line stays a single user bubble rather than duplicating the expanded prompt.
  await expect(page.getByText('/audit login flow', { exact: true })).toHaveCount(1);
  await expect(page.getByText(calls[0].user, { exact: true })).toHaveCount(0);
});
