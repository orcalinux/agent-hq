import { expect, test } from '@playwright/test';
import { resetFixtureWorkspace } from './fixture';
import { mockProvider } from './mocks';

test.beforeEach(() => resetFixtureWorkspace());

test('reported CLI models update inherited agent labels and exact choices without changing assignments', async ({ page }) => {
  await mockProvider(page);
  const automatic = {
    ref: 'anthropic:cli:default', id: 'cli:default', providerId: 'anthropic',
    name: 'Claude · automatic (verify to identify model)', via: 'cli', capabilities: ['chat'],
  };
  let models = [automatic];
  await page.route('**/api/connections', (route) => route.fulfill({ json: {
    ok: true,
    providers: [{
      id: 'anthropic', name: 'Anthropic', methods: ['cli'], envVars: [], envKeyPresent: false,
      connection: { method: 'cli', connectedAt: '2026-11-20' }, models,
    }],
  } }));
  await page.route('**/api/chat', async (route) => {
    expect(route.request().postDataJSON().model).toBe('anthropic:cli:default');
    models = [
      { ...automatic, name: 'claude-opus-fixture · last used (automatic)' },
      { ...automatic, ref: 'anthropic:cli:claude-opus-fixture', id: 'cli:claude-opus-fixture', name: 'claude-opus-fixture · Claude Code' },
    ];
    const body = [
      { type: 'delta', text: 'Hello from the reported model.' },
      { type: 'done', latencyMs: 1, models },
    ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
    await route.fulfill({ contentType: 'text/event-stream', body });
  });
  await page.goto('/');
  const nav = (name: string) => page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name, exact: true }).click();
  await nav('Connections');
  await page.getByRole('tab', { name: 'Role defaults' }).click();
  await page.getByRole('button', { name: 'Fill empty roles' }).click();
  await nav('Workspace');
  await page.getByRole('tab', { name: 'Ask', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message Sovereign' }).fill('Hello');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Hello from the reported model.', { exact: true })).toBeVisible();
  await nav('Agents');
  await page.getByRole('tab', { name: 'List', exact: true }).click();
  const rows = page.getByRole('table', { name: 'Agents', exact: true }).locator('tbody tr');
  await expect(rows).toHaveCount(7);
  for (const row of await rows.all()) await expect(row).toContainText('claude-opus-fixture · last used (automatic)');
  await page.getByRole('button', { name: 'Configure Pulse', exact: true }).click();
  const detail = page.getByRole('complementary', { name: 'Pulse', exact: true });
  await expect(detail).toContainText('Using the role default: claude-opus-fixture');
  await detail.getByRole('button', { name: 'Model', exact: true }).click();
  await expect(page.getByRole('option', { name: /claude-opus-fixture · Claude Code/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(rows.first()).toContainText('claude-opus-fixture · last used (automatic)');
});
