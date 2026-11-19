import { type Page, type Route } from '@playwright/test';

const MODEL_REF = 'anthropic:mock-model';

const PROVIDERS = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    methods: ['api_key'],
    envVars: [],
    envKeyPresent: false,
    docsUrl: 'https://example.invalid',
    notes: '',
    connection: { method: 'api_key', connectedAt: new Date().toISOString(), maskedKey: 'sk-t••••test' },
    models: [{ ref: MODEL_REF, providerId: 'anthropic', id: 'mock-model', name: 'Mock Model', via: 'api_key', capabilities: [] }],
  },
];

const MAGPIE_MODELS = [
  { id: 'daily-coding', name: 'daily-coding (routing group)' },
  { id: 'claude/claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
  { id: 'claude/claude-haiku-4-5', name: 'Claude Haiku 4.5' },
  { id: 'codex/gpt-5.1-codex', name: 'GPT-5.1 Codex' },
];

/** Magpie's local gateway as a connected provider, for screenshots of the integration. */
const MAGPIE_PROVIDER = {
  id: 'magpie',
  name: 'Magpie gateway',
  methods: ['local_endpoint'],
  envVars: ['MAGPIE_GATEWAY'],
  envKeyPresent: false,
  docsUrl: 'https://usemagpie.ai',
  notes: 'Uses the models, routing groups, subscriptions and failover you set up in Magpie, through its local gateway.',
  connection: { method: 'local_endpoint', connectedAt: new Date().toISOString(), endpointUrl: 'http://127.0.0.1:3425' },
  models: MAGPIE_MODELS.map((m) => ({ ref: `magpie:${m.id}`, providerId: 'magpie', id: m.id, name: m.name, via: 'local_endpoint', capabilities: ['chat', 'tools'] })),
};

export const PLAN = {
  summary: 'Update the greeting and add a subtract helper.',
  tasks: [
    { id: 't1', title: 'Update greeting', description: 'Change src/greeting.ts to greet the user.', stage: 'implementation', agentId: 'agent-frontend', priority: 'high', dependsOn: [] },
    { id: 't2', title: 'Add subtract helper', description: 'Add a subtract function next to add.', stage: 'implementation', agentId: 'agent-backend', priority: 'medium', dependsOn: [] },
    { id: 't3', title: 'Document the changes', description: 'Summarize both changes for the team.', stage: 'implementation', agentId: 'agent-architect', priority: 'low', dependsOn: ['t1', 't2'] },
  ],
};

export interface ChatCall {
  kind: 'plan' | 'task' | 'qa';
  task?: string;
  user: string;
  start: number;
  end: number;
}

function sse(text: string): string {
  const events = [
    { type: 'start', model: MODEL_REF, via: 'api_key' },
    { type: 'delta', text },
    { type: 'done', usage: { inputTokens: 100, outputTokens: 50 }, latencyMs: 5 },
  ];
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
}

function taskReply(title: string): string {
  if (title === 'Update greeting') return "Done.\n```ts path=src/greeting.ts\nexport const greeting = 'Hello, user';\n```";
  if (title === 'Add subtract helper') return 'Done.\n```ts path=src/math.ts\nexport const add = (a: number, b: number) => a + b;\nexport const subtract = (a: number, b: number) => a - b;\n```';
  return 'Both changes are small.\n```md path=docs/CHANGES.md\n# Changes\n\n- Greeting\n- Subtract\n```';
}

/** Stands in for the model provider: connections list one connected model and /api/chat answers from a script. */
export async function mockProvider(page: Page, delayMs = 700, opts: { magpie?: boolean } = {}): Promise<ChatCall[]> {
  const calls: ChatCall[] = [];
  const providers = opts.magpie ? [MAGPIE_PROVIDER, ...PROVIDERS] : PROVIDERS;
  await page.route('**/api/connections', (route) => route.fulfill({ json: { ok: true, providers } }));
  await page.route('**/api/connections/detect', (route) =>
    route.fulfill({
      json: {
        ok: true,
        clis: [],
        ollama: { reachable: false, endpoint: 'http://127.0.0.1:11434' },
        ...(opts.magpie ? { magpie: { reachable: true, endpoint: 'http://127.0.0.1:3425', models: MAGPIE_MODELS.length } } : {}),
      },
    })
  );
  await page.route('**/api/chat', async (route: Route) => {
    const body = route.request().postDataJSON() as { system: string; messages: Array<{ content: string }> };
    const user = body.messages[body.messages.length - 1].content;
    const call: ChatCall = { kind: 'task', user, start: Date.now(), end: 0 };
    let reply: string;
    if (body.system.includes('Mode: PLAN')) {
      call.kind = 'plan';
      reply = JSON.stringify(PLAN);
    } else if (body.system.includes('"verdict"')) {
      call.kind = 'qa';
      reply = JSON.stringify({ verdict: 'approve', summary: 'Looks correct.', issues: [] });
    } else {
      call.task = /Your task: (.+)/.exec(user)?.[1];
      reply = taskReply(call.task ?? '');
    }
    calls.push(call);
    if (call.kind === 'task') await new Promise((r) => setTimeout(r, delayMs));
    call.end = Date.now();
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse(reply) });
  });
  return calls;
}

export function trapErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  page.on('response', (res) => {
    if (res.status() >= 400 && !res.url().endsWith('favicon.ico')) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

export async function pick(page: Page, label: string, option: string | RegExp) {
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option }).click();
}
