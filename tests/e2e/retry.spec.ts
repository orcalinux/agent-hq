import { expect, test, type Page } from '@playwright/test';
import { mockProvider, pick } from './mocks';

const failure = (message: string) => `data: ${JSON.stringify({ type: 'error', message })}\n\n`;

async function askWithFailures(page: Page, failures: string[]) {
  await mockProvider(page, 10);
  let calls = 0;
  await page.route('**/api/chat', (route) => {
    calls += 1;
    if (calls <= failures.length) return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: failure(failures[calls - 1]) });
    return route.fallback();
  });
  await page.goto('/');
  await pick(page, 'Sovereign model', 'Mock Model');
  await page.getByRole('textbox', { name: 'Message Sovereign' }).fill('hello');
  await page.getByRole('button', { name: 'Send' }).click();
  return () => calls;
}

test('a temporary server error is retried once and the reply still arrives', async ({ page }) => {
  const calls = await askWithFailures(page, ['HTTP 503: upstream unavailable']);
  await expect(page.getByText('Both changes are small.')).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(calls()).toBe(2);
});

test('a persistent server error stops after two retries and is reported', async ({ page }) => {
  const calls = await askWithFailures(page, ['HTTP 502', 'HTTP 502', 'HTTP 502', 'HTTP 502']);
  await expect(page.getByRole('alert')).toContainText('HTTP 502', { timeout: 20000 });
  expect(calls()).toBe(3);
});

test('a client error such as a bad request is not retried', async ({ page }) => {
  const calls = await askWithFailures(page, ['HTTP 400: bad request']);
  await expect(page.getByRole('alert')).toContainText('HTTP 400');
  await page.waitForTimeout(1500);
  expect(calls()).toBe(1);
});
