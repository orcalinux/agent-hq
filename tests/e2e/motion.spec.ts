import { expect, test } from '@playwright/test';
import { mockProvider, trapErrors } from './mocks';

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`shared motion preserves selections, focus and resize behavior (${reducedMotion})`, async ({ page }, testInfo) => {
    const errors = trapErrors(page);
    await page.emulateMedia({ reducedMotion });
    await mockProvider(page);
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Primary' });
    await nav.getByRole('button', { name: 'Agents', exact: true }).click();
    const tabs = page.getByRole('tablist', { name: 'Agents view' });
    await expect(tabs).toBeVisible();
    for (const name of ['Graph', 'Office', 'List']) {
      await tabs.getByRole('tab', { name, exact: true }).click();
      await expect(tabs.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
    }
    for (const width of [880, 1280, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      for (const container of [tabs, nav]) {
        await expect.poll(async () => container.evaluate((node) => {
          const selected = node.querySelector('[aria-selected="true"], [aria-current="page"]')!.getBoundingClientRect();
          const indicator = node.querySelector('[data-selection-indicator]')!.getBoundingClientRect();
          return Math.max(Math.abs(selected.x - indicator.x), Math.abs(selected.y - indicator.y), Math.abs(selected.width - indicator.width));
        })).toBeLessThan(1);
      }
      await page.screenshot({ path: testInfo.outputPath(`agents-${width}.png`) });
    }
    for (let count = 0; count < 3; count += 1) {
      await nav.getByRole('button', { name: 'Collapse sidebar' }).click();
      await nav.getByRole('button', { name: 'Expand sidebar' }).click();
    }
    await page.getByRole('button', { name: 'Configure Pulse', exact: true }).click();
    const panel = page.getByRole('complementary', { name: 'Pulse', exact: true });
    const retained = await panel.getByRole('button', { name: 'Close details' }).evaluate(async (button) => {
      (button as HTMLButtonElement).click();
      await Promise.resolve();
      const closing = document.querySelector<HTMLElement>('aside[data-open="false"]');
      return closing?.inert ?? false;
    });
    expect(retained).toBe(reducedMotion === 'no-preference');
    await expect(page.locator('aside[data-open="false"]')).toHaveCount(0);
    const opener = page.getByRole('button', { name: 'Add agent', exact: true });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Add agent', exact: true });
    await expect(dialog.getByRole('textbox').first()).toBeFocused();
    const workflow = dialog.getByRole('button', { name: /^Workflow/ });
    await workflow.click();
    const list = page.getByRole('listbox');
    await expect(list).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(list).toBeHidden();
    await expect(workflow).toBeFocused();
    await workflow.click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(workflow).toContainText('Review / testing');
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('dialog.png') });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    expect(await page.locator('#root').evaluate((node) => (node as HTMLElement).inert)).toBe(false);
    await opener.click();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('dropdown closing can be interrupted without leaving a stale portal', async ({ page }) => {
  await mockProvider(page);
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Agents', exact: true }).click();
  await page.getByRole('button', { name: 'Add agent', exact: true }).click();
  const trigger = page.getByRole('dialog', { name: 'Add agent' }).getByRole('button', { name: /^Workflow/ });
  await trigger.click();
  await page.keyboard.press('Escape');
  await trigger.press('Enter');
  await expect(page.getByRole('listbox')).toBeFocused();
  await expect(page.locator('[data-ahq-popover]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-ahq-popover]')).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
