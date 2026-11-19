import { expect, test, type Page } from '@playwright/test';
import { resetFixtureWorkspace } from './fixture';

/**
 * Opt-in run against a real local model. Nothing is mocked: Sovereign, the agents and QA all
 * call Ollama through the Agent HQ server. Example:
 *   AGENT_HQ_E2E_LIVE_MODEL=qwen2.5:7b npm run test:e2e -- live-ollama
 */
const MODEL = process.env.AGENT_HQ_E2E_LIVE_MODEL;
const ENDPOINT = process.env.AGENT_HQ_E2E_OLLAMA || 'http://127.0.0.1:11434';
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

test.skip(!MODEL, 'Set AGENT_HQ_E2E_LIVE_MODEL to an installed Ollama model to run against a real provider.');
test.setTimeout(20 * 60_000);
test.use({ actionTimeout: 30_000 });

const modelOption = (name: string) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( \\(.*\\))?$`);

test('real provider: plan, approve and run end to end', async ({ page, request }) => {
  resetFixtureWorkspace();
  const connect = await request.post('/api/connections/connect', { data: { providerId: 'ollama', method: 'local_endpoint', endpointUrl: ENDPOINT } });
  const connected = await connect.json();
  expect(connected.ok, connected.error).toBe(true);
  const ref = `ollama:${MODEL}`;
  expect(connected.models.map((m: { ref: string }) => m.ref)).toContain(ref);

  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const calls = recordChat(page);
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await nav.getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByRole('tab', { name: 'Role defaults' }).click();
  for (const role of ROLES) {
    await page.getByRole('button', { name: `Default model for ${role}`, exact: true }).click();
    await page.getByRole('option', { name: modelOption(MODEL!) }).click();
  }
  await nav.getByRole('button', { name: 'Workspace', exact: true }).click();

  await page.getByRole('tab', { name: 'Plan' }).click();
  await page.getByRole('button', { name: 'Team strategy', exact: true }).click();
  await page.getByRole('option', { name: 'Only use my existing agents' }).click();
  await page.getByRole('textbox', { name: 'Message Sovereign' }).fill(
    'Make two independent changes, as two separate tasks with no dependency between them: ' +
      '(1) Pulse adds a `farewell` export to src/greeting.ts; (2) Titan adds a `subtract` function to src/math.ts. ' +
      'Use agent ids agent-frontend and agent-backend.'
  );
  await page.getByRole('button', { name: 'Send' }).click();

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
