import fs from 'fs';
import path from 'path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { E2E_WORKSPACE, resetFixtureWorkspace } from '../e2e/fixture';
import { mockProvider, pick } from '../e2e/mocks';

/** Walks the real app with scripted providers and saves the stills the demo video animates: npm run demo:capture */
const OUT = path.resolve('demo/public/shots');
const VIEWPORT = { width: 1600, height: 900 };
test.use({ viewport: VIEWPORT, deviceScaleFactor: 2, colorScheme: 'dark', reducedMotion: 'reduce' });

type Box = { x: number; y: number; width: number; height: number };
interface Shot { file: string; target?: Box; focus?: Box }
const shots: Record<string, Shot> = {};

const cli = (provider: 'anthropic' | 'openai', id: string, name: string) => ({ ref: `${provider}:cli:${id}`, providerId: provider, id: `cli:${id}`, name, via: 'cli', capabilities: ['chat'], selectable: true });
const viaMagpie = (id: string, name: string) => ({ ref: `magpie:${id}`, providerId: 'magpie', id, name, via: 'local_endpoint', capabilities: ['chat'], selectable: true });

function providers(groups: string[]) {
  const base = { envVars: [], envKeyPresent: false, docsUrl: 'https://example.invalid', notes: '' };
  const signedIn = { method: 'cli', connectedAt: new Date().toISOString() };
  return [
    { ...base, id: 'anthropic', name: 'Anthropic', methods: ['api_key', 'env', 'cli'], connection: signedIn, models: [cli('anthropic', 'claude-opus-5-5', 'Claude Opus 5.5'), cli('anthropic', 'claude-sonnet-5-5', 'Claude Sonnet 5.5'), cli('anthropic', 'claude-haiku-5-5', 'Claude Haiku 5.5')] },
    { ...base, id: 'openai', name: 'OpenAI', methods: ['api_key', 'env', 'cli'], connection: signedIn, models: [cli('openai', 'gpt-5', 'GPT-5 Codex'), cli('openai', 'gpt-5-mini', 'GPT-5 mini')] },
    { ...base, id: 'google', name: 'Google Gemini', methods: ['api_key', 'env', 'cli'], connection: null, models: [] },
    {
      ...base, id: 'magpie', name: 'Magpie gateway', methods: ['local_endpoint'], connection: { method: 'local_endpoint', connectedAt: new Date().toISOString(), endpointUrl: 'http://127.0.0.1:3425' },
      models: [...groups.map((id) => viaMagpie(`group/${id}`, `${id} · routing group`)), viaMagpie('claude/claude-opus-5-5', 'Claude Opus 5.5 · Claude Code'), viaMagpie('codex/gpt-5', 'GPT-5 Codex · Codex')],
    },
  ];
}

const PLAN = {
  summary: 'Greet the user by name, add a subtract helper, and document both.',
  tasks: [
    { id: 't1', title: 'Update greeting', description: 'Change src/greeting.ts to greet the user by name.', stage: 'implementation', agentId: 'agent-frontend', complexity: 'simple', priority: 'high', dependsOn: [] },
    { id: 't2', title: 'Add subtract helper', description: 'Add a subtract function next to add.', stage: 'implementation', agentId: 'agent-backend', complexity: 'standard', model: 'openai:cli:gpt-5', modelReason: 'Codex is strong at small typed helpers', priority: 'medium', dependsOn: [] },
    { id: 't3', title: 'Document the changes', description: 'Summarize both changes for the team.', stage: 'implementation', agentId: 'agent-architect', complexity: 'complex', priority: 'low', dependsOn: ['t1', 't2'] },
  ],
};

const REPLIES: Record<string, string> = {
  'Update greeting': "Done.\n```ts path=src/greeting.ts\nexport const greeting = (name: string) => `Hello, ${name}!`;\n```",
  'Add subtract helper': 'Done.\n```ts path=src/math.ts\nexport const add = (a: number, b: number) => a + b;\nexport const subtract = (a: number, b: number) => a - b;\n```',
  'Document the changes': 'Both changes are small.\n```md path=docs/CHANGES.md\n# Changes\n\n- The greeting now uses the user\'s name.\n- New `subtract` helper next to `add`.\n```',
};

const LESSONS: Array<[string, string, string, number, number, number]> = [
  ['agent-frontend', 'convention', 'Style buttons with Tailwind classes from the shared tokens, never inline styles.', 2, 6, 49],
  ['agent-frontend', 'pitfall', 'Tailwind tokens for buttons live in src/styles/globals.css; check both themes.', 1, 4, 30],
  ['agent-backend', 'fact', 'Database migrations live in db/migrations and run before seeding the database.', 1, 3, 40],
  ['agent-backend', 'pitfall', 'Validate request bodies at the API boundary; the database layer trusts its input.', 0, 2, 12],
  ['agent-qa', 'pitfall', 'Run the verification command after every rework, not only on the first pass.', 2, 5, 22],
  ['agent-architect', 'decision', 'State lives in small zustand stores per feature; no global store.', 1, 4, 35],
  ['agent-intern-1', 'pitfall', 'Ask Pulse before changing shared Tailwind tokens.', 0, 1, 5],
  ['team', 'preference', 'Keep commit messages short and in the imperative.', 0, 7, 44],
];

function seedLessons() {
  const now = Date.now();
  const day = 24 * 3600 * 1000;
  const sources = ['qa', 'reflection', 'mentor', 'user'];
  const lessons = LESSONS.map(([agentId, kind, text, reinforced, uses, daysAgo], i) => ({
    id: `demo-${i}`, agentId, kind, text, source: sources[i % sources.length],
    createdAt: now - daysAgo * day, updatedAt: now - Math.max(0, daysAgo - 1) * day, reinforced, uses,
  }));
  fs.mkdirSync(path.join(E2E_WORKSPACE, '.agent-hq/memory'), { recursive: true });
  fs.writeFileSync(path.join(E2E_WORKSPACE, '.agent-hq/memory/lessons.json'), JSON.stringify({ version: 1, lessons }));
}

async function box(locator: Locator): Promise<Box | undefined> {
  const b = await locator.boundingBox();
  return b ? { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) } : undefined;
}

/** Saves a still; `target` is where the cursor clicks next, `focus` is the region the camera zooms to. */
async function snap(page: Page, id: string, opts: { target?: Locator; focus?: Locator } = {}) {
  const anchor = opts.focus ?? opts.target;
  if (anchor) {
    await anchor.evaluate((el) => {
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: 'center', inline: 'nearest' });
    });
  }
  const focus = opts.focus ? await box(opts.focus) : undefined;
  const target = opts.target ? await box(opts.target) : undefined;
  await page.mouse.move(0, 0);
  await page.waitForTimeout(350);
  const file = `${id}.png`;
  await page.screenshot({ path: path.join(OUT, file) });
  shots[id] = { file, target, focus };
}

test('capture the demo video stills', async ({ page }) => {
  test.setTimeout(240_000);
  fs.mkdirSync(OUT, { recursive: true });
  resetFixtureWorkspace();
  seedLessons();

  await mockProvider(page, 2500, { magpie: true });
  let groups: string[] = [];
  await page.route('**/api/connections', (route) => route.fulfill({ json: { ok: true, providers: providers(groups) } }));
  await page.route('**/api/connections/refresh', (route) => route.fulfill({ json: { ok: true, models: [], detail: '' } }));
  await page.route('**/api/models/rescan', (route) => route.fulfill({ json: { ok: true, results: [] } }));
  await page.route('**/api/connections/detect', (route) => route.fulfill({
    json: {
      ok: true,
      clis: [
        { binary: 'claude', detected: true, version: '2.1.328 (Claude Code)', executionSupported: true, signIn: 'Verified when you connect', purpose: 'Claude Code CLI — model execution with its own sign-in' },
        { binary: 'codex', detected: true, version: 'codex-cli 0.170.0', executionSupported: true, signIn: 'Logged in using ChatGPT', purpose: 'OpenAI Codex CLI — model execution with its own sign-in' },
        { binary: 'gemini', detected: false, executionSupported: true, purpose: 'Gemini CLI — model execution with its own sign-in' },
      ],
      installs: {
        gemini: { name: 'Gemini CLI', command: 'npm i -g @google/gemini-cli', url: 'https://github.com/google-gemini/gemini-cli' },
      },
      ollama: { reachable: true, endpoint: 'http://127.0.0.1:11434', models: 6 },
      magpie: { reachable: true, endpoint: 'http://127.0.0.1:3425', models: 30 },
    },
  }));
  await page.route('**/api/magpie/quotas', (route) => route.fulfill({
    json: { ok: true, quotas: [
      { provider: 'claude', name: 'Claude Code', kind: 'subscription', plan: 'max', windows: [{ name: '5 hours', remaining: 85 }, { name: 'week', remaining: 62 }] },
      { provider: 'codex', name: 'Codex', kind: 'subscription', plan: 'plus', windows: [{ name: '5 hours', remaining: 41 }, { name: 'week', remaining: 7 }] },
    ] },
  }));
  await page.route('**/api/magpie/groups', (route) => {
    const body = route.request().postDataJSON() as { groups: Array<{ id: string }> };
    groups = body.groups.map((g) => g.id);
    return route.fulfill({ json: { ok: true, results: body.groups.map((g) => ({ id: g.id, ok: true })) } });
  });
  await page.route('**/api/chat', async (route) => {
    const body = route.request().postDataJSON() as { system: string; messages: Array<{ content: string }> };
    const user = body.messages[body.messages.length - 1].content;
    let reply: string;
    let wait = 0;
    if (body.system.includes('Mode: PLAN')) reply = JSON.stringify(PLAN);
    else if (body.system.includes('"verdict"')) reply = JSON.stringify({ verdict: 'approve', summary: 'Both changes are correct and typed.', issues: [] });
    else {
      reply = REPLIES[/Your task: (.+)/.exec(user)?.[1] ?? ''] ?? 'Done.';
      wait = 2500;
    }
    if (wait) await new Promise((r) => setTimeout(r, wait));
    const events = [{ type: 'start', model: 'anthropic:cli:claude-sonnet-5-5', via: 'cli' }, { type: 'delta', text: reply }, { type: 'done', usage: { inputTokens: 1800, outputTokens: 420 }, latencyMs: 900 }];
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') });
  });

  const parent = path.dirname(E2E_WORKSPACE);
  await page.route('**/api/workspace', (route) => route.fulfill({ json: { ok: true, root: E2E_WORKSPACE, name: 'demo-app', lockedByEnv: false, recent: [] } }));
  await page.route('**/api/fs/browse**', (route) => route.fulfill({
    json: { ok: true, path: parent, parent: path.dirname(parent), home: parent, truncated: false, dirs: ['api-server', 'demo-app', 'design-system', 'mobile-app', 'website'].map((name) => ({ name, path: path.join(parent, name), isProject: true })) },
  }));

  await page.goto('/');
  const terminalInput = page.locator('[data-testid="integrated-terminal"] .xterm-helper-textarea');
  await terminalInput.focus();
  await page.keyboard.type("export PS1='\\[\\e[36m\\]demo-app\\[\\e[0m\\] $ '; clear");
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  const nav = page.getByRole('navigation', { name: 'Primary' });
  const go = async (view: string) => {
    await nav.getByRole('button', { name: view, exact: true }).click();
    await page.waitForTimeout(500);
  };

  await go('Connections');
  await expect(page.getByText('gemini', { exact: true })).toBeVisible();
  await snap(page, 'connections', { target: page.getByRole('button', { name: 'Connect', exact: true }).first() });
  await snap(page, 'local-tools', { target: page.getByRole('button', { name: 'Install' }).first(), focus: page.getByRole('table').last() });

  await page.getByRole('tab', { name: 'Role defaults' }).click();
  await page.waitForTimeout(400);
  await snap(page, 'roles-empty', { target: page.getByRole('button', { name: 'Fill empty roles' }) });
  await page.getByRole('button', { name: 'Fill empty roles' }).click();
  await page.waitForTimeout(500);
  await snap(page, 'roles-filled');

  const project = nav.getByRole('button', { name: /demo-app/ });
  await snap(page, 'project-trigger', { target: project });
  await project.click();
  const dialog = page.getByRole('dialog', { name: 'Project', exact: true });
  await expect(dialog).toBeVisible();
  await snap(page, 'project', { focus: dialog });
  await page.keyboard.press('Escape');

  await go('Workspace');
  await page.getByRole('tab', { name: 'Plan' }).click();
  await page.getByRole('textbox', { name: 'Message Sovereign' }).fill('Greet the user by name and add a subtract helper next to add.');
  await snap(page, 'plan-ask', { target: page.getByRole('button', { name: 'Send' }) });
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Proposed plan · 3 tasks')).toBeVisible();
  const approve = page.getByRole('button', { name: 'Approve & run' }).last();
  await snap(page, 'plan-card', { target: page.getByRole('button', { name: 'Model for Add subtract helper' }).last(), focus: page.getByText('Proposed plan · 3 tasks').locator('xpath=ancestor::*[.//button[normalize-space()="Approve & run"]][1]') });
  await snap(page, 'plan-approve', { target: approve });
  await approve.click();

  await expect(page.getByText(/Update greeting/).first()).toBeVisible();
  await page.waitForTimeout(1500);
  await go('Tasks');
  await snap(page, 'tasks');
  await go('Agents');
  await page.getByRole('tab', { name: 'Graph' }).click();
  await page.waitForTimeout(900);
  await snap(page, 'graph');
  await page.getByRole('tab', { name: 'Office' }).click();
  await page.waitForTimeout(1200);
  await snap(page, 'office');
  await page.getByRole('tab', { name: 'Graph' }).click();

  await go('Workspace');
  await expect(page.getByText(/Run completed and approved by QA/)).toBeVisible({ timeout: 60_000 });
  await page.getByRole('tab', { name: /Changes/ }).click();
  await page.getByRole('button', { name: 'Diff' }).first().click();
  await page.waitForTimeout(500);
  await snap(page, 'changes');

  const terminal = page.getByTestId('integrated-terminal');
  await page.getByRole('tab', { name: 'Terminal', exact: true }).click();
  await expect(terminal.getByRole('tab')).toHaveCount(1);
  await terminalInput.focus();
  await page.keyboard.type('ls src && wc -l src/*.ts');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  await snap(page, 'terminal', { focus: terminal });

  await go('Settings');
  const section = page.locator('#settings-models');
  await snap(page, 'settings-models', { focus: section.getByRole('region', { name: 'How model choice works' }) });
  await pick(page, 'Complex model', 'Claude Opus 5.5');
  await section.getByRole('tablist', { name: 'Complex level mode' }).getByRole('tab', { name: 'Locked' }).click();
  await snap(page, 'levels', { target: section.getByRole('tablist', { name: 'Complex level mode' }), focus: section.getByRole('list', { name: 'Model for each complexity' }) });
  await section.getByRole('tablist', { name: 'Force my setup' }).getByRole('tab', { name: 'On' }).click();
  await expect(section.getByText('Your setup always wins')).toBeVisible();
  await snap(page, 'force', { target: section.getByRole('tablist', { name: 'Force my setup' }), focus: section.getByText('Your setup always wins') });
  await section.getByRole('tablist', { name: 'Force my setup' }).getByRole('tab', { name: 'Off' }).click();

  const magpie = section.getByRole('tablist', { name: 'Let Magpie pick the account' });
  await snap(page, 'magpie-off', { target: magpie.getByRole('tab', { name: 'On' }) });
  await magpie.getByRole('tab', { name: 'On' }).click();
  await expect(section.getByRole('list', { name: 'Magpie groups' })).toBeVisible();
  await page.waitForTimeout(600);
  await snap(page, 'magpie-on', { focus: section.getByLabel('Subscription quota') });
  await snap(page, 'decisions', { focus: section.getByRole('table', { name: 'Recent model decisions' }) });
  await snap(page, 'ranking', { focus: section.getByRole('table', { name: 'Model ranking' }) });

  await go('Agents');
  await page.getByRole('tab', { name: 'List', exact: true }).click();
  await page.getByRole('button', { name: 'Configure Titan', exact: true }).click();
  const titan = page.getByRole('complementary', { name: 'Titan', exact: true });
  await titan.getByRole('button', { name: 'Model', exact: true }).click();
  await page.getByRole('option', { name: 'Claude Haiku 5.5', exact: true }).click();
  await titan.getByRole('tab', { name: 'Always this model' }).click();
  await expect(titan.getByText('Always: this agent')).toBeVisible();
  await snap(page, 'agent-lock', { target: titan.getByRole('tab', { name: 'Always this model' }), focus: titan.getByRole('region', { name: 'Model' }) });
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Onboard junior' }).click();
  const onboard = page.getByRole('dialog', { name: 'Onboard a junior agent' });
  await pick(page, 'Specialty', 'QA');
  await onboard.getByRole('textbox').first().fill('Probe');
  await snap(page, 'onboard', { target: onboard.getByRole('button', { name: 'Mentor', exact: true }), focus: onboard });
  await page.keyboard.press('Escape');

  await go('Growth');
  await page.waitForTimeout(600);
  await snap(page, 'growth');

  await go('Settings');
  const full = page.getByRole('radio', { name: /Full access/ });
  await snap(page, 'permissions', { target: full, focus: full.locator('xpath=ancestor::*[@role="radiogroup"][1]') });

  await go('Reports');
  await page.waitForTimeout(500);
  await snap(page, 'reports');

  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ viewport: VIEWPORT, scale: 2, shots }, null, 2));
});
