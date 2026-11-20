import { expect, test } from '@playwright/test';
import { resetFixtureWorkspace } from './fixture';
import { mockProvider } from './mocks';

test.beforeEach(() => resetFixtureWorkspace());

test('model pickers show exact models and old assignments migrate to exact IDs', async ({ page }) => {
  await mockProvider(page);
  const automatic = {
    ref: 'anthropic:cli:default', id: 'cli:default', providerId: 'anthropic',
    name: 'claude-opus-fixture', via: 'cli', capabilities: ['chat'],
    selectable: false, canonicalRef: 'anthropic:cli:claude-opus-fixture',
  };
  const pricing = { source: 'account', inputPerM: 4, outputPerM: 20, cacheReadPerM: 0.2, cacheWritePerM: 5 };
  const exact = { ...automatic, ref: 'anthropic:cli:claude-opus-fixture', id: 'cli:claude-opus-fixture', selectable: true, canonicalRef: undefined, pricing };
  let models = [exact, automatic, { ...automatic, ref: 'anthropic:cli:sonnet', id: 'cli:sonnet', name: 'Choose an exact model', canonicalRef: undefined }];
  await page.addInitScript(() => {
    if (!localStorage.getItem('agent-hq.state')) localStorage.setItem('agent-hq.state', JSON.stringify({
      version: 2,
      state: { roleDefaults: Object.fromEntries(['manager', 'architect', 'frontend', 'backend', 'qa', 'intern'].map((role) => [role, 'anthropic:cli:default'])) },
    }));
  });
  await page.route('**/api/connections', (route) => route.fulfill({ json: {
    ok: true,
    providers: [{
      id: 'anthropic', name: 'Anthropic', methods: ['cli'], envVars: [], envKeyPresent: false,
      connection: { method: 'cli', connectedAt: '2026-11-20' }, models,
    }],
  } }));
  await page.route('**/api/chat', async (route) => {
    expect(route.request().postDataJSON().model).toBe('anthropic:cli:claude-opus-fixture');
    models = [
      { ...exact, name: 'Claude Opus Fixture' },
      { ...automatic, name: 'Claude Opus Fixture' },
    ];
    const body = [
      { type: 'delta', text: 'Hello from the reported model.' },
      { type: 'done', latencyMs: 1, models, usage: { inputTokens: 1000, outputTokens: 2000, totalTokens: 13000, cacheReadTokens: 10000 } },
    ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
    await route.fulfill({ contentType: 'text/event-stream', body });
  });
  await page.goto('/');
  const nav = (name: string) => page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name, exact: true }).click();
  await nav('Workspace');
  await page.getByRole('tab', { name: 'Ask', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message Sovereign' }).fill('Hello');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Hello from the reported model.', { exact: true })).toBeVisible();
  await nav('Agents');
  await page.getByRole('tab', { name: 'List', exact: true }).click();
  const rows = page.getByRole('table', { name: 'Agents', exact: true }).locator('tbody tr');
  await expect(rows).toHaveCount(7);
  for (const row of await rows.all()) await expect(row).toContainText('Claude Opus Fixture');
  await page.getByRole('button', { name: 'Configure Pulse', exact: true }).click();
  const detail = page.getByRole('complementary', { name: 'Pulse', exact: true });
  await expect(detail).toContainText('Using the role default: Claude Opus Fixture');
  await detail.getByRole('button', { name: 'Model', exact: true }).click();
  await expect(page.getByRole('option', { name: 'Claude Opus Fixture', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: /alias|automatic|Choose an exact model/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(rows.first()).toContainText('Claude Opus Fixture');
  const roles = await page.evaluate(() => JSON.parse(localStorage.getItem('agent-hq.state')!).state.roleDefaults);
  expect(Object.values(roles)).toEqual(Array(6).fill('anthropic:cli:claude-opus-fixture'));
  await nav('Connections');
  await page.getByRole('tab', { name: 'Models', exact: true }).click();
  await expect(page.getByRole('main').locator('tbody tr')).toHaveCount(1);
  await expect(page.getByRole('main').locator('tbody tr')).toContainText('Claude Opus Fixture');
  const pricingCell = page.getByTestId('model-pricing');
  await expect(pricingCell).toContainText('$4 in / $20 out');
  await expect(pricingCell).toContainText('Claude account rates');
  await expect(pricingCell).toContainText('cache read $0.2');
  await expect(page.getByRole('main').locator('tbody tr').getByRole('button', { name: /Set price|Edit/ })).toHaveCount(0);
  await nav('Reports');
  await expect(page.getByTestId('cost-note')).toContainText("Includes $0.05 of Claude Code usage valued at your account's API rates");
});
