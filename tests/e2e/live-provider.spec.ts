import { expect, test, type Page } from '@playwright/test';
import { resetFixtureWorkspace } from './fixture';

/**
 * Opt-in run against a real model. Nothing is mocked: Sovereign, the agents and QA all call the
 * provider through the Agent HQ server. Examples:
 *   AGENT_HQ_E2E_LIVE_MODEL=qwen2.5:7b npm run test:e2e -- live-provider
 *   AGENT_HQ_E2E_LIVE_PROVIDER=magpie AGENT_HQ_E2E_LIVE_MODEL=claude/claude-haiku-4-5 npm run test:e2e -- live-provider
 */
const MODEL = process.env.AGENT_HQ_E2E_LIVE_MODEL;
const PROVIDER = process.env.AGENT_HQ_E2E_LIVE_PROVIDER === 'magpie' ? 'magpie' : 'ollama';
const ENDPOINT =
  PROVIDER === 'magpie'
    ? process.env.AGENT_HQ_E2E_MAGPIE || 'http://127.0.0.1:3425'
    : process.env.AGENT_HQ_E2E_OLLAMA || 'http://127.0.0.1:11434';
const ROLES = ['Orchestrator (Sovereign)', 'Architect (Aegis)', 'Frontend (Pulse)', 'Backend (Titan)', 'QA and security (Sentinel)', 'Junior agents (Nova, Byte)'];

interface Call {
  system: string;
  user: string;
  start: number;
  end?: number;
}

function recordChat(page: Page): Call[] {
  const calls: Call[] = [];
  const byRequest = new Map<object, Call>();
  page.on('request', (req) => {
    if (!req.url().endsWith('/api/chat')) return;
    const body = req.postDataJSON() as { system: string; messages: Array<{ content: string }> };
    const call = { system: body.system, user: body.messages[body.messages.length - 1].content, start: Date.now() };
    byRequest.set(req, call);
    calls.push(call);
  });
  const finish = (req: object) => {
    const call = byRequest.get(req);
    if (call) call.end = Date.now();
  };
  page.on('requestfinished', finish);
  page.on('requestfailed', finish);
  return calls;
}

test.skip(!MODEL, 'Set AGENT_HQ_E2E_LIVE_MODEL (and AGENT_HQ_E2E_LIVE_PROVIDER=magpie for Magpie) to run against a real provider.');
test.setTimeout(20 * 60_000);
test.use({ actionTimeout: 30_000 });

const modelOption = (name: string) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( \\(.*\\))?$`);

async function setUpRealTeam(page: Page, request: import('@playwright/test').APIRequestContext) {
  resetFixtureWorkspace();
  const connect = await request.post('/api/connections/connect', { data: { providerId: PROVIDER, method: 'local_endpoint', endpointUrl: ENDPOINT } });
  const connected = await connect.json();
  expect(connected.ok, connected.error).toBe(true);
  const ref = `${PROVIDER}:${MODEL}`;
  const model = (connected.models as Array<{ ref: string; name: string }>).find((m) => m.ref === ref);
  expect(model, `${ref} is offered by ${PROVIDER}`).toBeDefined();

  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const calls = recordChat(page);
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await nav.getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByRole('tab', { name: 'Role defaults' }).click();
  for (const role of ROLES) {
    await page.getByRole('button', { name: `Default model for ${role}`, exact: true }).click();
    await page.getByRole('option', { name: modelOption(model!.name) }).first().click();
  }
  return { errors, calls, nav };
}

async function askForTwoTasks(page: Page) {
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.getByRole('tab', { name: 'Plan' }).click();
  await page.getByRole('button', { name: 'Team strategy', exact: true }).click();
  await page.getByRole('option', { name: 'Only use my existing agents' }).click();
  await page.getByRole('textbox', { name: 'Message Sovereign' }).fill(
    'Make two independent changes, as two separate tasks with no dependency between them: ' +
      '(1) Pulse adds a `farewell` export to src/greeting.ts; (2) Titan adds a `subtract` function to src/math.ts. ' +
      'Use agent ids agent-frontend and agent-backend.'
  );
  await page.getByRole('button', { name: 'Send' }).click();
}

test('real provider: plan, approve and run end to end', async ({ page, request }) => {
  const { errors, calls } = await setUpRealTeam(page, request);
  await askForTwoTasks(page);

  const planOrError = page.getByText(/Proposed plan · \d+ tasks|Could not read a plan/);
  await expect(planOrError).toBeVisible({ timeout: 10 * 60_000 });
  await expect(page.getByText(/Could not read a plan/), 'the model returned a plan the app could parse').toHaveCount(0);
  await page.getByRole('button', { name: 'Approve & run' }).click();

  const outcome = page.getByText(/Run completed and approved by QA|Run failed/);
  await expect(outcome).toBeVisible({ timeout: 15 * 60_000 });
  const outcomeText = await outcome.first().innerText();
  test.info().annotations.push({ type: 'outcome', description: outcomeText });

  const taskCalls = calls.filter((c) => c.user.includes('Your task: '));
  expect(taskCalls.length, 'agents were called with real tasks').toBeGreaterThanOrEqual(2);
  for (const c of taskCalls) expect(c.end, 'every task stream finished').toBeDefined();
  const greeting = taskCalls.find((c) => /greeting/i.test(c.user.split('Your task: ')[1] ?? ''));
  if (greeting) expect(greeting.user, 'the task that names src/greeting.ts receives its contents').toContain('GREETING-MARKER');
  const overlapping = taskCalls.some((a, i) => taskCalls.slice(i + 1).some((b) => a.start < b.end! && b.start < a.end!));
  test.info().annotations.push({ type: 'parallel', description: String(overlapping) });
  test.info().annotations.push({
    type: 'calls',
    description: calls.map((c) => `${c.system.includes('Mode: PLAN') ? 'plan' : c.system.includes('"verdict"') ? 'qa' : 'task'} ${((c.end! - c.start) / 1000).toFixed(1)}s`).join(', '),
  });
  console.log(JSON.stringify(test.info().annotations, null, 1));
  expect(errors).toEqual([]);
});

test('real provider: a run limit stops a real run and keeps it resumable', async ({ page, request }) => {
  const { errors, calls, nav } = await setUpRealTeam(page, request);
  await nav.getByRole('button', { name: 'Settings', exact: true }).click();
  const tokens = page.getByRole('spinbutton', { name: /Tokens per run/ });
  await tokens.fill('1');
  await tokens.press('Enter');
  await askForTwoTasks(page);

  await expect(page.getByText(/Proposed plan · \d+ tasks|Could not read a plan/)).toBeVisible({ timeout: 10 * 60_000 });
  await expect(page.getByText(/Could not read a plan/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Approve & run' }).click();

  await expect(page.getByText(/Run failed: Stopped by run limit: [\d,]+ of the 1 token limit/).first()).toBeVisible({ timeout: 10 * 60_000 });
  await expect(page.getByRole('button', { name: 'Resume run' })).toBeVisible();
  const taskCalls = calls.filter((c) => c.user.includes('Your task: '));
  expect(taskCalls.length, 'no task started after the limit was reached (at most the 3 allowed to run at once)').toBeLessThanOrEqual(3);
  expect(calls.some((c) => c.system.includes('"verdict"')), 'QA never ran').toBe(false);
  test.info().annotations.push({ type: 'task calls', description: String(taskCalls.length) });
  console.log(JSON.stringify(test.info().annotations, null, 1));
  expect(errors).toEqual([]);
});
