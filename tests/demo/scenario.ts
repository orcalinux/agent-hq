import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { expect, type Page } from '@playwright/test';
import { E2E_WORKSPACE } from '../e2e/fixture';

/**
 * The world every tutorial episode is recorded in: the real app and server, a real throwaway project on disk, a real
 * terminal and git, and model providers replaced by a script so recording never spends account credit.
 */

const cli = (provider: 'anthropic' | 'openai', id: string, name: string) => ({ ref: `${provider}:cli:${id}`, providerId: provider, id: `cli:${id}`, name, via: 'cli', capabilities: ['chat'], selectable: true });
const viaMagpie = (id: string, name: string) => ({ ref: `magpie:${id}`, providerId: 'magpie', id, name, via: 'local_endpoint', capabilities: ['chat'], selectable: true });

export const CLAUDE = [cli('anthropic', 'claude-opus-5-5', 'Claude Opus 5.5'), cli('anthropic', 'claude-sonnet-5-5', 'Claude Sonnet 5.5'), cli('anthropic', 'claude-haiku-5-5', 'Claude Haiku 5.5')];
export const CODEX = [cli('openai', 'gpt-5', 'GPT-5 Codex'), cli('openai', 'gpt-5-mini', 'GPT-5 mini')];

export interface ScriptedPlan {
  /** Matches the user's request. */
  when: RegExp;
  plan: Record<string, unknown>;
  /** Task title -> what the agent answers, usually a fenced file. */
  replies: Record<string, string>;
}

export interface WorldOptions {
  plans: ScriptedPlan[];
  /** Seconds each task takes, so the board and the office have something to show. */
  taskSeconds?: number;
  /** Providers that start connected. The setup episode connects Anthropic itself. */
  connected?: Array<'anthropic' | 'openai' | 'magpie'>;
  /** Shows a parent folder until the project is opened, for the episode that opens it. */
  projectChooser?: boolean;
}

export interface World {
  connect(id: 'anthropic' | 'openai' | 'magpie'): void;
  calls: Array<{ kind: string; task?: string; model?: string }>;
}

function sse(model: string, text: string) {
  const events = [{ type: 'start', model, via: model.startsWith('magpie') ? 'local_endpoint' : 'cli' }, { type: 'delta', text }, { type: 'done', usage: { inputTokens: 2400 + text.length, outputTokens: 180 + Math.round(text.length / 3) }, latencyMs: 1400 }];
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
}

export async function world(page: Page, opts: WorldOptions): Promise<World> {
  const connected = new Set(opts.connected ?? ['anthropic', 'openai', 'magpie']);
  let groups: string[] = [];
  const calls: World['calls'] = [];
  const providers = () => {
    const base = { envVars: [], envKeyPresent: false, docsUrl: 'https://example.invalid', notes: '' };
    const signedIn = (id: string) => (connected.has(id as 'anthropic') ? { method: 'cli', connectedAt: new Date().toISOString() } : null);
    return [
      { ...base, id: 'anthropic', name: 'Anthropic', cliBinary: 'claude', methods: ['api_key', 'env_key', 'cli'], connection: signedIn('anthropic'), models: connected.has('anthropic') ? CLAUDE : [] },
      { ...base, id: 'openai', name: 'OpenAI', cliBinary: 'codex', methods: ['api_key', 'env_key', 'cli'], connection: signedIn('openai'), models: connected.has('openai') ? CODEX : [] },
      { ...base, id: 'google', name: 'Google Gemini', cliBinary: 'gemini', methods: ['api_key', 'env_key', 'cli'], connection: null, models: [] },
      { ...base, id: 'ollama', name: 'Ollama (local)', methods: ['local_endpoint'], connection: null, models: [] },
      {
        ...base, id: 'magpie', name: 'Magpie gateway', methods: ['local_endpoint'],
        connection: connected.has('magpie') ? { method: 'local_endpoint', connectedAt: new Date().toISOString(), endpointUrl: 'http://127.0.0.1:3425' } : null,
        models: connected.has('magpie') ? [...groups.map((id) => viaMagpie(`group/${id}`, `${id} · routing group`)), viaMagpie('claude/claude-opus-5-5', 'Claude Opus 5.5 · Claude Code'), viaMagpie('claude/claude-sonnet-5-5', 'Claude Sonnet 5.5 · Claude Code'), viaMagpie('codex/gpt-5', 'GPT-5 Codex · Codex')] : [],
      },
    ];
  };
  const anthropic = () => providers()[0];

  await page.route('**/api/connections', (route) => route.fulfill({ json: { ok: true, providers: providers() } }));
  await page.route('**/api/connections/test', (route) => route.fulfill({ json: { ok: true, detail: 'Claude Code 2.1.328 is signed in. 3 models available. (Scripted for this recording.)', models: CLAUDE } }));
  await page.route('**/api/connections/connect', (route) => {
    connected.add('anthropic');
    return route.fulfill({ json: { ok: true, provider: anthropic(), models: CLAUDE } });
  });
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
      installs: { gemini: { name: 'Gemini CLI', command: 'npm i -g @google/gemini-cli', url: 'https://github.com/google-gemini/gemini-cli' } },
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
  await page.route('**/api/magpie/groups/remove', (route) => {
    groups = [];
    return route.fulfill({ json: { ok: true } });
  });

  let current: ScriptedPlan | undefined;
  await page.route('**/api/chat', async (route) => {
    const body = route.request().postDataJSON() as { model?: string; system: string; messages: Array<{ content: string }> };
    const user = body.messages.at(-1)!.content;
    const model = body.model || 'anthropic:cli:claude-sonnet-5-5';
    let reply: string;
    let wait = 0.6;
    if (body.system.includes('Mode: PLAN')) {
      current = opts.plans.find((p) => p.when.test(user)) ?? opts.plans[0];
      reply = JSON.stringify(current.plan);
      wait = 1.6;
      calls.push({ kind: 'plan', model });
    } else if (body.system.includes('Mode: ASK')) {
      reply = 'The project has two modules: `src/greeting.ts` exports the greeting, and `src/math.ts` holds small number helpers.';
      wait = 1.2;
    } else if (body.system.includes('long-term memory')) {
      reply = JSON.stringify({ lessons: [] });
    } else if (body.system.includes('N+1 senior mentor')) {
      reply = 'VERDICT: APPROVE\nNOTES: Clear and small. Good job.';
      wait = 1.2;
      calls.push({ kind: 'mentor', model });
    } else if (body.system.includes('"verdict"')) {
      reply = JSON.stringify({ verdict: 'approve', summary: 'All changes are correct, typed and documented.', issues: [] });
      wait = 1.4;
      calls.push({ kind: 'qa', model });
    } else {
      const task = /Your task: (.+)/.exec(user)?.[1] ?? '';
      reply = current?.replies[task] ?? 'Done.';
      wait = opts.taskSeconds ?? 2.5;
      calls.push({ kind: 'task', task, model });
    }
    await new Promise((r) => setTimeout(r, wait * 1000));
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse(model, reply) }).catch(() => undefined);
  });

  if (opts.projectChooser) {
    const parent = path.dirname(E2E_WORKSPACE);
    let opened = false;
    await page.route('**/api/workspace', (route) => route.fulfill({ json: { ok: true, root: opened ? E2E_WORKSPACE : parent, name: opened ? 'demo-app' : 'Projects', lockedByEnv: false, recent: [] } }));
    await page.route('**/api/workspace/root', (route) => {
      expect(route.request().postDataJSON().path).toBe(E2E_WORKSPACE);
      opened = true;
      return route.fulfill({ json: { ok: true, root: E2E_WORKSPACE, name: 'demo-app' } });
    });
    await page.route('**/api/fs/browse**', (route) => route.fulfill({
      json: { ok: true, path: parent, parent: path.dirname(parent), home: parent, truncated: false, dirs: ['api-server', 'demo-app', 'design-system', 'mobile-app', 'website'].map((name) => ({ name, path: path.join(parent, name), isProject: true })) },
    }));
  }

  return { connect: (id) => connected.add(id), calls };
}

export const nav = (page: Page) => page.getByRole('navigation', { name: 'Primary' });

/** Puts the fixture project under git with one commit, so the Changes panel can show what agents modified. */
export function commitFixture() {
  const run = (...args: string[]) => {
    const r = spawnSync('git', args, { cwd: E2E_WORKSPACE, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  };
  fs.writeFileSync(path.join(E2E_WORKSPACE, 'README.md'), '# demo-app\n\nA tiny TypeScript project used in the Agent HQ tutorials.\n');
  fs.writeFileSync(path.join(E2E_WORKSPACE, 'src/greeting.ts'), "export const greeting = 'Hello, world';\n");
  fs.writeFileSync(path.join(E2E_WORKSPACE, '.gitignore'), '.agent-hq/\nnode_modules/\n');
  run('init', '-q', '-b', 'main');
  run('-c', 'user.name=Demo', '-c', 'user.email=demo@example.invalid', 'add', '-A');
  run('-c', 'user.name=Demo', '-c', 'user.email=demo@example.invalid', 'commit', '-qm', 'Initial commit');
}

export const read = (rel: string) => (fs.existsSync(path.join(E2E_WORKSPACE, rel)) ? fs.readFileSync(path.join(E2E_WORKSPACE, rel), 'utf8') : null);

/** Fills every role off camera, for episodes that start after setup. */
export async function quickSetup(page: Page) {
  await nav(page).getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByRole('tab', { name: 'Role defaults' }).click();
  await page.getByRole('button', { name: 'Fill empty roles' }).click();
  await nav(page).getByRole('button', { name: 'Workspace', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message Sovereign' })).toBeVisible();
}

/** Gives the shell a short prompt so terminal shots stay readable. The cd re-enters the fixture, which a reset recreates under shells that outlive a test. */
export async function tidyTerminal(page: Page) {
  const input = page.locator('[data-testid="integrated-terminal"] .xterm-helper-textarea');
  await input.focus();
  await page.keyboard.type(`cd '${E2E_WORKSPACE}'; export PS1='\\[\\e[36m\\]demo-app\\[\\e[0m\\] $ '; clear`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
}

const LESSONS: Array<[string, string, string, number, number, number]> = [
  ['agent-frontend', 'convention', 'Style buttons with Tailwind classes from the shared tokens, never inline styles.', 2, 6, 49],
  ['agent-frontend', 'pitfall', 'Tailwind tokens for buttons live in src/styles/globals.css; check both themes.', 1, 4, 30],
  ['agent-backend', 'fact', 'Number helpers live in src/math.ts and are exported one function per line.', 1, 3, 40],
  ['agent-backend', 'pitfall', 'Validate inputs at the API boundary; inner helpers trust their input.', 0, 2, 12],
  ['agent-qa', 'pitfall', 'Run the verification command after every rework, not only on the first pass.', 2, 5, 22],
  ['agent-architect', 'decision', 'State lives in small zustand stores per feature; no global store.', 1, 4, 35],
  ['agent-intern-1', 'pitfall', 'Ask Pulse before changing shared Tailwind tokens.', 0, 1, 5],
  ['team', 'preference', 'Keep commit messages short and in the imperative.', 0, 7, 44],
];

export function seedLessons() {
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

export const GREETING_PLAN: ScriptedPlan = {
  when: /greet/i,
  plan: {
    summary: 'Greet the user by name, add a subtract helper, and document both.',
    tasks: [
      { id: 't1', title: 'Update greeting', description: 'Change src/greeting.ts to greet the user by name.', stage: 'implementation', agentId: 'agent-frontend', complexity: 'simple', priority: 'high', dependsOn: [] },
      { id: 't2', title: 'Add subtract helper', description: 'Add a subtract function next to add in src/math.ts.', stage: 'implementation', agentId: 'agent-backend', complexity: 'standard', model: 'openai:cli:gpt-5', modelReason: 'Codex is strong at small typed helpers', priority: 'medium', dependsOn: [] },
      { id: 't3', title: 'Document the changes', description: 'Summarize both changes in docs/CHANGES.md.', stage: 'implementation', agentId: 'agent-architect', complexity: 'complex', priority: 'low', dependsOn: ['t1', 't2'] },
    ],
  },
  replies: {
    'Update greeting': "Done.\n```ts path=src/greeting.ts\nexport const greeting = (name: string) => `Hello, ${name}!`;\n```",
    'Add subtract helper': 'Done.\n```ts path=src/math.ts\nexport const add = (a: number, b: number) => a + b;\nexport const subtract = (a: number, b: number) => a - b;\n```',
    'Document the changes': "Both changes are small.\n```md path=docs/CHANGES.md\n# Changes\n\n- The greeting now uses the user's name.\n- New `subtract` helper next to `add`.\n```",
  },
};
