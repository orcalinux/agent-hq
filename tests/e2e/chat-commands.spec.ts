import { expect, test } from '@playwright/test';

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
