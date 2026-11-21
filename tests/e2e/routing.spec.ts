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

const taskRow = (page: Page, title: string) => page.getByRole('listitem').filter({ has: page.getByText(title, { exact: true }) }).last();

const PLAN = {
  summary: 'A rename and a redesign.',
  tasks: [
    { id: 't1', title: 'Rename the button', description: 'Rename it.', stage: 'implementation', agentId: 'agent-frontend', complexity: 'simple', priority: 'low', dependsOn: [] },
    { id: 't2', title: 'Redesign the auth flow', description: 'Rework sessions.', stage: 'architecture', agentId: 'agent-architect', complexity: 'complex', priority: 'high', dependsOn: [] },
    { id: 't3', title: 'Add the endpoint', description: 'Add it.', stage: 'implementation', agentId: 'agent-backend', complexity: 'standard', model: 'openai:cli:gpt-5', modelReason: 'Codex is strong at endpoints', priority: 'medium', dependsOn: [] },
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
  await expect(taskRow(page, 'Add the endpoint')).toContainText('Sovereign: Codex is strong at endpoints');
  await expect(taskRow(page, 'Add the endpoint').getByText('Sovereign', { exact: true })).toHaveAttribute('title', /Codex is strong at endpoints/);
  await expect(taskRow(page, 'Rename the button').getByText('Auto', { exact: true })).toBeVisible();
  expect(mock.plan()).toContain('simple: anthropic:cli:claude-haiku-5-5');
  expect(mock.plan()).toContain('across 2 connected providers');
  expect(mock.plan()).toMatch(/openai:cli:gpt-5 \| GPT-5 Codex \| OpenAI \| complex \| 90/);

  await pick(page, 'Complexity for Rename the button', 'Complex');
  await expect(page.getByRole('button', { name: 'Model for Rename the button' })).toContainText('Claude Opus 5.5');
  await expect(taskRow(page, 'Rename the button').getByText('Auto', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Model for Redesign the auth flow' })).toContainText('GPT-5 Codex');
  await pick(page, 'Model for Redesign the auth flow', 'Claude Sonnet 5.5');
  await expect(taskRow(page, 'Redesign the auth flow').getByText('You', { exact: true })).toBeVisible();
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
  await expect(section.getByText('preferred', { exact: true })).toBeVisible();

  await expect(section.getByRole('region', { name: 'How model choice works' })).toContainText('It is dynamic, not a one-time setup');
  await expect(section.getByRole('region', { name: 'How model choice works' })).toContainText('Choose models yourself');
  const ranking = section.getByRole('table', { name: 'Model ranking' });
  await expect(ranking).toContainText('GPT-5 Codex');
  await expect(ranking.getByText('In use').first()).toBeVisible();
  await section.getByRole('tab', { name: 'Simple', exact: true }).first().click();
  await expect(ranking).toContainText('Claude Haiku 5.5');
  await expect(ranking).not.toContainText('GPT-5 Codex');
  await section.getByRole('tab', { name: 'All', exact: true }).click();
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
  await section.getByRole('tablist', { name: 'Pick the model by task complexity' }).getByRole('tab', { name: 'Off', exact: true }).click();
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

test('Magpie picks the account for Auto levels; Force my setup and a locked agent override Sovereign', async ({ page }) => {
  const errors = trapErrors(page);
  await setup(page);
  const viaMagpie = (id: string, name: string) => ({ ref: `magpie:${id}`, providerId: 'magpie', id, name, via: 'local_endpoint', capabilities: ['chat'], selectable: true });
  const copies = [viaMagpie('claude/claude-opus-5-5', 'Claude Opus 5.5 · Claude Code'), viaMagpie('codex/gpt-5', 'GPT-5 Codex · Codex'), viaMagpie('claude/claude-sonnet-5-5', 'Claude Sonnet 5.5 · Claude Code')];
  let synced: string[] = [];
  const syncs: Array<{ groups: Array<{ id: string; models: string[]; routing: string }> }> = [];
  const all = () => [
    ...providers(),
    {
      id: 'magpie', name: 'Magpie gateway', methods: ['local_endpoint'], envVars: [], envKeyPresent: false, docsUrl: 'https://example.invalid', notes: '',
      connection: { method: 'local_endpoint', connectedAt: new Date().toISOString() },
      models: [...synced.map((id) => viaMagpie(`group/${id}`, `${id} · routing group`)), ...copies],
    },
  ];
  await page.route('**/api/connections', (route) => route.fulfill({ json: { ok: true, providers: all() } }));
  await page.route('**/api/connections/refresh', (route) => route.fulfill({ json: { ok: true, models: [], detail: '' } }));
  await page.route('**/api/magpie/quotas', (route) =>
    route.fulfill({ json: { ok: true, quotas: [{ provider: 'claude', name: 'Claude Code', kind: 'subscription', plan: 'pro', windows: [{ name: '5 hours', remaining: 85 }] }, { provider: 'codex', name: 'Codex', kind: 'subscription', windows: [{ name: '5 hours', remaining: 4 }] }] } })
  );
  await page.route('**/api/magpie/groups', (route) => {
    const body = route.request().postDataJSON() as (typeof syncs)[number];
    syncs.push(body);
    synced = body.groups.map((g) => g.id);
    return route.fulfill({ json: { ok: true, results: body.groups.map((g) => ({ id: g.id, ok: true })) } });
  });
  let removed = 0;
  await page.route('**/api/magpie/groups/remove', (route) => {
    removed++;
    synced = [];
    return route.fulfill({ json: { ok: true } });
  });

  await page.goto('/');
  await page.getByRole('tab', { name: 'Plan' }).click();
  await pick(page, 'Sovereign model', /^Claude Opus 5\.5$/);
  await nav(page, 'Settings');
  const section = page.locator('#settings-models');
  const quota = section.getByLabel('Subscription quota');
  await expect(quota).toContainText('85% left');
  await expect(quota).toContainText('4% left');

  await section.getByRole('tablist', { name: 'Let Magpie pick the account' }).getByRole('tab', { name: 'On' }).click();
  await expect.poll(() => syncs.length).toBeGreaterThanOrEqual(1);
  const complex = syncs[0].groups.find((g) => g.id === 'agenthq-complex')!;
  expect([...complex.models].sort()).toEqual(['claude/claude-opus-5-5', 'codex/gpt-5']);
  expect(complex.routing).toBe('usage');
  expect(syncs[0].groups.some((g) => g.id === 'agenthq-simple')).toBe(false);
  const groups = section.getByRole('list', { name: 'Magpie groups' });
  await expect(groups).toContainText('GPT-5 Codex');
  await expect(groups.getByText('in use').first()).toBeVisible();
  await section.getByRole('tab', { name: 'Weekly pace' }).click();
  await expect.poll(() => syncs.at(-1)?.groups[0].routing).toBe('pace');

  await nav(page, 'Workspace');
  await page.getByRole('textbox', { name: 'Message Sovereign' }).fill('Redesign auth and add the endpoint.');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('button', { name: 'Model for Redesign the auth flow' }).last()).toContainText('agenthq-complex');
  await expect(taskRow(page, 'Redesign the auth flow')).toContainText('Auto · via Magpie');
  await expect(taskRow(page, 'Add the endpoint')).toContainText('Sovereign');

  await nav(page, 'Settings');
  await section.getByRole('tablist', { name: 'Force my setup' }).getByRole('tab', { name: 'On' }).click();
  await expect(section.getByText('Your setup always wins')).toBeVisible();
  await pick(page, 'Complex model', 'Claude Sonnet 5.5');
  await expect(section.getByRole('tablist', { name: 'Complex level mode' }).getByRole('tab', { name: 'Locked' })).toHaveAttribute('aria-selected', 'true');
  await expect(section.getByRole('tablist', { name: 'Complex level mode' }).getByRole('tab', { name: 'Preferred' })).toBeDisabled();

  await nav(page, 'Agents');
  await page.getByRole('tab', { name: 'List', exact: true }).click();
  await page.getByRole('button', { name: 'Configure Titan', exact: true }).click();
  const titan = page.getByRole('complementary', { name: 'Titan', exact: true });
  await expect(titan.getByRole('tab', { name: 'Always this model' })).toBeDisabled();
  await titan.getByRole('button', { name: 'Model', exact: true }).click();
  await page.getByRole('option', { name: 'Claude Haiku 5.5', exact: true }).click();
  await titan.getByRole('tab', { name: 'Always this model' }).click();
  await expect(titan.getByText('Always: this agent')).toBeVisible();
  await page.keyboard.press('Escape');

  await nav(page, 'Workspace');
  await page.getByRole('textbox', { name: 'Message Sovereign' }).fill('Again with my setup forced.');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('button', { name: 'Model for Redesign the auth flow' }).last()).toContainText('Claude Sonnet 5.5');
  await expect(taskRow(page, 'Redesign the auth flow')).toContainText('Locked');
  await expect(page.getByRole('button', { name: 'Model for Add the endpoint' }).last()).toContainText('Claude Haiku 5.5');
  await expect(taskRow(page, 'Add the endpoint')).toContainText("Agent's model");

  await page.getByRole('button', { name: 'Approve & run' }).last().click();
  await nav(page, 'Settings');
  const decisions = section.getByRole('table', { name: 'Recent model decisions' });
  await expect(decisions).toContainText('Redesign the auth flow');
  await expect(decisions).toContainText('Locked');
  await expect(decisions).toContainText("Agent's model");

  await section.getByRole('tablist', { name: 'Let Magpie pick the account' }).getByRole('tab', { name: 'Off' }).click();
  await expect.poll(() => removed).toBe(1);
  expect(errors).toEqual([]);
});

