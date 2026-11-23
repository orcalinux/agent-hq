import { expect, test } from '@playwright/test';

test('commands and mentions complete by keyboard or mouse without sending the draft', async ({ page }) => {
  const modelRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/chat') modelRequests.push(request.url());
  });
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Message Sovereign' });
  const menu = page.getByTestId('chat-completions');
  await input.fill('/');
  await expect(menu.getByRole('option', { name: /\/remember/ })).toBeVisible();
  await input.press('Tab');
  await expect(input).toHaveValue('/remember ');
  await expect(input).toBeFocused();
  await expect(menu).toBeHidden();
  await input.pressSequentially('@pu');
  await expect(menu.getByRole('option', { name: /@Pulse/ })).toHaveAttribute('aria-selected', 'true');
  await input.press('Enter');
  await expect(input).toHaveValue('/remember @Pulse ');
  await expect(menu).toBeHidden();
  await input.pressSequentially('Use the shared Button component');
  await expect(input).toHaveValue('/remember @Pulse Use the shared Button component');

  await input.fill('Ask @');
  const first = await menu.getByRole('option').first().getAttribute('id');
  await expect(input).toHaveAttribute('aria-activedescendant', first!);
  await input.press('ArrowDown');
  const second = await menu.getByRole('option').nth(1).getAttribute('id');
  await expect(input).toHaveAttribute('aria-activedescendant', second!);
  await input.press('ArrowUp');
  await expect(input).toHaveAttribute('aria-activedescendant', first!);
  await input.press('ArrowUp');
  const last = await menu.getByRole('option').last().getAttribute('id');
  await expect(input).toHaveAttribute('aria-activedescendant', last!);
  await menu.getByRole('option', { name: /@Pulse/ }).click();
  await expect(input).toHaveValue('Ask @Pulse ');
  await expect(input).toBeFocused();

  await input.fill('Ask @Pu about the buttons');
  await input.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(7, 7));
  await expect(menu).toBeVisible();
  await input.press('Tab');
  await expect(input).toHaveValue('Ask @Pulse about the buttons');
  await expect(input).toHaveJSProperty('selectionStart', 11);

  await input.fill('@');
  await expect(menu).toBeVisible();
  await input.press('Escape');
  await expect(menu).toBeHidden();
  await expect(input).toBeFocused();
  await input.press('Tab');
  await expect(input).not.toBeFocused();
  expect(modelRequests).toEqual([]);
});

test('empty matches, multiline input, IME, selection and ordinary text keep their editing behaviour', async ({ page }) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Message Sovereign' });
  const menu = page.getByTestId('chat-completions');
  await input.fill('@does-not-exist');
  await expect(menu).toContainText('No matching agents');
  await expect(input).not.toHaveAttribute('aria-activedescendant');
  await input.press('Shift+Enter');
  await expect(input).toHaveValue('@does-not-exist\n');
  await expect(menu).toBeHidden();

  for (const value of ['hello@example.com', 'read /tmp/project', 'plain text']) {
    await input.fill(value);
    await expect(menu).toBeHidden();
  }
  await input.fill('@Pulse');
  await input.selectText();
  await expect(menu).toBeHidden();
  await input.fill('@');
  await expect(menu).toBeVisible();
  await input.dispatchEvent('compositionstart');
  await expect(menu).toBeHidden();
  await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  await expect(input).toHaveValue('@');
  await input.dispatchEvent('compositionend');
  await expect(menu).toBeVisible();
  await page.getByText('Talk to Sovereign', { exact: true }).click();
  await expect(menu).toBeHidden();
});

test('the live roster and long names fit the menu across window sizes and themes', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Agents', exact: true }).click();
  await page.getByRole('button', { name: 'Add agent', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add agent' });
  const name = 'Embedded Firmware And Reliability Specialist';
  await dialog.getByRole('textbox').first().fill(name);
  await dialog.getByRole('button', { name: 'Add agent', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Message Sovereign' });
  const menu = page.getByTestId('chat-completions');
  await input.fill('@Embedded');
  await expect(menu.getByRole('option')).toContainText(name);
  const selectedId = (await menu.getByRole('option').innerText()).match(/@(agent-[\w-]+)/)![1];
  await input.press('Tab');
  await expect(input).toHaveValue(`@${selectedId} `);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const [width, height] of [[640, 360], [1000, 700], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    for (const theme of ['light', 'dark']) {
      await page.evaluate((mode) => { document.documentElement.dataset.theme = mode; }, theme);
      await input.fill('@');
      await expect(menu).toBeVisible();
      const bounds = (await menu.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
      await input.press('ArrowUp');
      await expect(menu.locator('[aria-selected="true"]')).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath(`mentions-${width}-${theme}.png`) });
    }
  }
});
