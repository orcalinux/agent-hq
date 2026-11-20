import fs from 'fs';
import path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { E2E_WORKSPACE, resetFixtureWorkspace } from './fixture';
import { mockProvider, pick, trapErrors } from './mocks';

test.beforeEach(() => resetFixtureWorkspace());

const PLAN = {
  summary: 'Update the greeting.',
  tasks: [{ id: 't1', title: 'Update greeting', description: 'Change src/greeting.ts to greet the user.', stage: 'implementation', agentId: 'agent-frontend', priority: 'high', dependsOn: [] }],
};

const LESSONS = {
  lessons: [
    { agentId: 'agent-frontend', kind: 'pitfall', text: 'Greeting strings live in src/greeting.ts and must name the user.' },
    { agentId: 'team', kind: 'convention', text: 'Hand work to QA only after checking the greeting copy.' },
  ],
};

function sse(text: string) {
  return [{ type: 'delta', text }, { type: 'done', usage: { inputTokens: 10, outputTokens: 5 }, latencyMs: 1 }].map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
}

const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name, exact: true }).click();
const lessonsOnDisk = () => JSON.parse(fs.readFileSync(path.join(E2E_WORKSPACE, '.agent-hq/memory/lessons.json'), 'utf8')).lessons as Array<{ agentId: string; text: string; source: string; uses: number }>;

test('agents remember what they are taught, learn from review feedback, and use it on later tasks', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = trapErrors(page);
  await mockProvider(page, 50);
  const taskSystems: string[] = [];
  let reflection = '';
  let qaCalls = 0;
  await page.route('**/api/chat', async (route) => {
    const body = route.request().postDataJSON() as { system: string; messages: Array<{ content: string }> };
    const user = body.messages.at(-1)!.content;
    let reply: string;
    if (body.system.includes('Mode: PLAN')) reply = JSON.stringify(PLAN);
    else if (body.system.includes('long-term memory')) {
      reflection = user;
      reply = JSON.stringify(LESSONS);
    } else if (body.system.includes('"verdict"')) {
      qaCalls++;
      reply = JSON.stringify(qaCalls === 1
        ? { verdict: 'reject', summary: 'The greeting does not name the user.', issues: [{ taskId: 't1', problem: 'The greeting must name the user.' }] }
        : { verdict: 'approve', summary: 'Looks correct.', issues: [] });
    } else {
      taskSystems.push(body.system);
      reply = "Done.\n```ts path=src/greeting.ts\nexport const greeting = 'Hello, user';\n```\n```json path=.agent-hq/memory/lessons.json\n{\"lessons\": []}\n```";
    }
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse(reply) });
  });

  await page.goto('/');
  await nav(page, 'Connections');
  await page.getByRole('tab', { name: 'Role defaults' }).click();
  await page.getByRole('button', { name: 'Fill empty roles' }).click();
  await nav(page, 'Workspace');

  const input = page.getByRole('textbox', { name: 'Message Sovereign' });
  await input.fill('/remember @Pulse Use the shared Button component for every action');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText("Saved to Pulse's memory.", { exact: false })).toBeVisible();
  await input.fill('/remember @Nobody anything');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('No agent is called Nobody.')).toBeVisible();

  await page.getByRole('tab', { name: 'Plan' }).click();
  await pick(page, 'Team strategy', 'Only use my existing agents');
  await input.fill('Greet the user.');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByRole('button', { name: 'Approve & run' }).click();
  await expect(page.getByText(/Run completed and approved by QA\. 1 proposed file change/)).toBeVisible({ timeout: 30_000 });

  expect(taskSystems).toHaveLength(2);
  expect(taskSystems[0]).toContain('- [convention] Use the shared Button component for every action');
  await expect.poll(() => reflection).toContain('qa feedback for Pulse (agent-frontend): Update greeting: - The greeting must name the user.');

  await expect.poll(() => lessonsOnDisk().length).toBe(3);
  expect(lessonsOnDisk().map((l) => [l.agentId, l.source])).toEqual([['agent-frontend', 'user'], ['agent-frontend', 'reflection'], ['team', 'reflection']]);
  expect(lessonsOnDisk()[0].uses).toBeGreaterThanOrEqual(2);

  await nav(page, 'Agents');
  await page.getByRole('tab', { name: 'List', exact: true }).click();
  await page.getByRole('button', { name: 'Configure Pulse', exact: true }).click();
  const memory = page.getByRole('region', { name: 'Memory' });
  await expect(memory.getByTestId('lesson')).toHaveCount(2);
  await expect(memory).toContainText('Greeting strings live in src/greeting.ts and must name the user.');
  await expect(memory).toContainText('Run reflection');
  await expect(memory).toContainText('1 team lesson also apply to Pulse.');
  await expect(memory.getByTestId('memory-stats')).toContainText('2Lessons');

  await memory.getByRole('textbox', { name: 'Teach Pulse' }).fill('Prefer small components over large files');
  await memory.getByRole('button', { name: 'Teach' }).click();
  await expect(memory.getByRole('status')).toContainText('Pulse will use this on relevant tasks.');
  await expect(memory.getByTestId('lesson')).toHaveCount(3);

  await memory.getByRole('textbox', { name: 'Search memory' }).fill('button');
  await expect(memory.getByTestId('lesson')).toHaveCount(1);
  await expect(memory.getByTestId('lesson')).toContainText('Keyword match');
  await memory.getByRole('textbox', { name: 'Search memory' }).fill('');

  const first = memory.getByTestId('lesson').filter({ hasText: 'Prefer small components' });
  await first.getByRole('button', { name: 'Pin lesson (always used)' }).click();
  await expect(first).toContainText('Pinned');
  await memory.getByTestId('lesson').filter({ hasText: 'shared Button' }).getByRole('button', { name: 'Forget lesson' }).click();
  await expect(memory.getByTestId('lesson')).toHaveCount(2);
  expect(lessonsOnDisk().map((l) => l.text)).not.toContain('Use the shared Button component for every action');
  await page.keyboard.press('Escape');

  await nav(page, 'Reports');
  await expect(page.getByTestId('learning-summary')).toContainText('3 lessons on this project, 3 learned this week, 1 shared by the whole team');

  expect(errors).toEqual([]);
});

test('memory settings install an embedding model and switch search to meaning', async ({ page }) => {
  const errors = trapErrors(page);
  await mockProvider(page, 50);
  const base = { endpoint: 'http://127.0.0.1:11434', reachable: true, preference: 'auto', recommended: 'nomic-embed-text' };
  await page.route('**/api/memory/status', (route) => route.fulfill({ json: { ok: true, mode: 'keyword', embedding: { ...base, installed: [] } } }));
  await page.route('**/api/memory/embedding/pull', (route) => route.fulfill({
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
    body: [
      { type: 'progress', status: 'pulling manifest' },
      { type: 'progress', status: 'downloading', completed: 50, total: 100 },
      { type: 'done', mode: 'hybrid', embedding: { ...base, installed: ['nomic-embed-text:latest'], active: 'nomic-embed-text:latest' } },
    ].map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''),
  }));
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Settings', exact: true }).click();
  const status = page.getByTestId('memory-search-status');
  await expect(status).toContainText('Keywords only');
  await status.getByRole('button', { name: 'Install nomic-embed-text' }).click();
  await expect(status).toContainText('Keywords and meaning');
  await expect(status).toContainText('nomic-embed-text is installed.');
  await expect(status.getByRole('button', { name: 'Rebuild search index' })).toBeVisible();
  await page.getByRole('tab', { name: 'Only after feedback' }).click();
  await expect(page.getByText('Lessons are written only when QA, a mentor or the verification command pushed back')).toBeVisible();
  expect(errors).toEqual([]);
});
