import { expect, test, type Page } from '@playwright/test';
import { resetFixtureWorkspace } from './fixture';
import { mockProvider, pick, trapErrors } from './mocks';

test.beforeEach(() => resetFixtureWorkspace());

const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name, exact: true }).click();

const model = (provider: 'anthropic' | 'openai', id: string, name: string) => ({ ref: `${provider}:cli:${id}`, providerId: provider, id: `cli:${id}`, name, via: 'cli', capabilities: ['chat'], selectable: true });
const CLAUDE = [model('anthropic', 'claude-opus-5-5', 'Claude Opus 5.5'), model('anthropic', 'claude-sonnet-5-5', 'Claude Sonnet 5.5'), model('anthropic', 'claude-haiku-5-5', 'Claude Haiku 5.5')];

function providers(claude = CLAUDE) {
  const base = { methods: ['cli'], envVars: [], envKeyPresent: false, docsUrl: 'https://example.invalid', notes: '', connection: { method: 'cli', connectedAt: new Date().toISOString() } };
  return [
    { ...base, id: 'anthropic', name: 'Anthropic', models: claude },
    { ...base, id: 'openai', name: 'OpenAI', models: [model('openai', 'gpt-5', 'GPT-5 Codex')] },
  ];
}

const PLAN = {
  summary: 'A rename and a redesign.',
  tasks: [
    { id: 't1', title: 'Rename the button', description: 'Rename it.', stage: 'implementation', agentId: 'agent-frontend', complexity: 'simple', priority: 'low', dependsOn: [] },
    { id: 't2', title: 'Redesign the auth flow', description: 'Rework sessions.', stage: 'architecture', agentId: 'agent-architect', complexity: 'complex', priority: 'high', dependsOn: [] },
    { id: 't3', title: 'Add the endpoint', description: 'Add it.', stage: 'implementation', agentId: 'agent-backend', complexity: 'standard', model: 'openai:cli:gpt-5', priority: 'medium', dependsOn: [] },
  ],
};

async function setup(page: Page) {
  await mockProvider(page, 50);
  let current = providers();
  await page.route('**/api/connections', (route) => route.fulfill({ json: { ok: true, providers: current } }));
  let rescans = 0;
  await page.route('**/api/models/rescan', (route) => {
    rescans++;
    return route.fulfill({ json: { ok: true, results: [{ providerId: 'anthropic', ok: true, count: current[0].models.length }] } });
  });
  let planSystem = '';
  await page.route('**/api/chat', async (route) => {
    const body = route.request().postDataJSON() as { system: string };
    planSystem = body.system;
    const events = [{ type: 'delta', text: JSON.stringify(PLAN) }, { type: 'done', latencyMs: 1 }];
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') });
  });
  return {
    release: (claude: typeof CLAUDE) => (current = providers(claude)),
    plan: () => planSystem,
    rescans: () => rescans,
  };
}

test('each task gets the best model for its complexity across providers, and Sovereign may pick another provider', async ({ page }) => {
  const errors = trapErrors(page);
  const mock = await setup(page);
  await page.goto('/');
  await page.getByRole('tab', { name: 'Plan' }).click();
  await pick(page, 'Sovereign model', 'Claude Opus 5.5');
  await page.getByRole('textbox', { name: 'Message Sovereign' }).fill('Rename the button and redesign auth.');
  await page.getByRole('button', { name: 'Send' }).click();

  await expect(page.getByRole('button', { name: 'Model for Rename the button' })).toContainText('Claude Haiku 5.5');
  await expect(page.getByRole('button', { name: 'Model for Redesign the auth flow' })).toContainText('Claude Opus 5.5');
  await expect(page.getByRole('button', { name: 'Model for Add the endpoint' })).toContainText('GPT-5 Codex');
  expect(mock.plan()).toContain('simple: anthropic:cli:claude-haiku-5-5');
  expect(mock.plan()).toContain('across 2 connected providers');
  expect(mock.plan()).toMatch(/openai:cli:gpt-5 \| GPT-5 Codex \| OpenAI \| complex \| 90/);

  await pick(page, 'Complexity for Rename the button', 'Complex');
  await expect(page.getByRole('button', { name: 'Model for Rename the button' })).toContainText('Claude Opus 5.5');
  await page.getByRole('button', { name: 'Model for Rename the button' }).click();
  await expect(page.getByRole('option', { name: 'Claude Sonnet 5.5' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'GPT-5 Codex' })).toBeVisible();
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('Settings pins tiers, and a newly released model is picked up by the update check', async ({ page }) => {
  const errors = trapErrors(page);
  const mock = await setup(page);
  await page.goto('/');
  await page.getByRole('tab', { name: 'Plan' }).click();
  await pick(page, 'Sovereign model', 'Claude Opus 5.5');
  await nav(page, 'Settings');
  const section = page.locator('#settings-models');
  await expect(section.getByRole('tab', { name: 'All connected providers' })).toHaveAttribute('aria-selected', 'true');
  await expect(section.getByRole('button', { name: 'Complex model' })).toContainText('Auto · Claude Opus 5.5 (Anthropic)');
  await pick(page, 'Simple model', 'Claude Sonnet 5.5');
  await expect(section.getByText('pinned')).toBeVisible();

  await section.getByRole('button', { name: 'Check now' }).click();
  await expect(section.getByText(/Last checked/)).toBeVisible();
  mock.release([model('anthropic', 'claude-opus-6', 'Claude Opus 6'), ...CLAUDE]);
  await section.getByRole('button', { name: 'Check now' }).click();
  await expect(section.getByRole('list', { name: 'Recent model changes' })).toContainText('New: Claude Opus 6');
  await expect(section.getByRole('list', { name: 'Recent model changes' })).toContainText('Complex tasks moved to Claude Opus 6');
  await expect(section.getByRole('button', { name: 'Complex model' })).toContainText('Auto · Claude Opus 6');
  await expect(section.getByRole('button', { name: 'Simple model' })).toContainText('Claude Sonnet 5.5');
  expect(mock.rescans()).toBeGreaterThanOrEqual(2);

  await section.getByRole('tab', { name: "Only Sovereign's provider" }).click();
  await expect(section.getByText('even when others are connected')).toBeVisible();
  await section.getByRole('tab', { name: 'Off', exact: true }).first().click();
  await expect(section.getByText("Tasks run on their agent's own model")).toBeVisible();
  expect(errors).toEqual([]);
});

test("0.10.0's saved one-provider default becomes all providers once, a choice made by hand stays", async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('agent-hq.state', JSON.stringify({ state: { modelScope: 'sovereign' }, version: 2 }));
  });
  await page.goto('/');
  await nav(page, 'Settings');
  const section = page.locator('#settings-models');
  await expect(section.getByRole('tab', { name: 'All connected providers' })).toHaveAttribute('aria-selected', 'true');
  await section.getByRole('tab', { name: "Only Sovereign's provider" }).click();
  await page.reload();
  await nav(page, 'Settings');
  await expect(page.locator('#settings-models').getByRole('tab', { name: "Only Sovereign's provider" })).toHaveAttribute('aria-selected', 'true');
});
