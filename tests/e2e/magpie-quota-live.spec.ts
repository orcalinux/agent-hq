import { expect, test } from '@playwright/test';
import { mockProvider } from './mocks';

const quota = (remaining: number) => ({
  ok: true,
  quotas: [{ provider: 'codex', name: 'Codex', kind: 'subscription', plan: 'plus', readAt: new Date().toISOString(), windows: [{ name: '5 hours', remaining, resetsAt: new Date(Date.now() + 3 * 3_600_000).toISOString() }] }],
});

test('quota left follows the gateway: refresh, window focus and failed reads', async ({ page }) => {
  await mockProvider(page, 50, { magpie: true });
  let reply: object = quota(7);
  let calls = 0;
  await page.route('**/api/magpie/quotas', (route) => {
    calls += 1;
    return route.fulfill({ json: reply });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const panel = page.getByLabel('Subscription quota');
  await expect(panel.getByText(/^7% left/)).toBeVisible();
  await expect(page.getByTestId('quota-updated')).toContainText('Live');

  reply = quota(0);
  await panel.getByRole('button', { name: 'Refresh' }).click();
  await expect(panel.getByText(/^0% left/)).toBeVisible();
  await expect(panel.getByText(/^7% left/)).toHaveCount(0);

  reply = quota(12);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(panel.getByText(/^12% left/)).toBeVisible();

  reply = { ok: false, quotas: [], error: 'The Magpie gateway is not running.' };
  await panel.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByTestId('quota-updated')).toContainText('Could not refresh');
  await expect(panel.getByText('may be out of date')).toBeVisible();
  await expect(panel.getByText(/^12% left/)).toBeVisible();
  expect(calls).toBeGreaterThanOrEqual(4);
});
