import { expect, test, type Page } from '@playwright/test';
import { resetFixtureWorkspace } from './fixture';
import { mockProvider, pick, trapErrors } from './mocks';

test.beforeEach(() => resetFixtureWorkspace());

const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name, exact: true }).click();
const details = (page: Page, name: string) => page.getByRole('complementary', { name, exact: true });

async function openAgent(page: Page, name: string) {
  await nav(page, 'Agents');
  await page.getByRole('tab', { name: 'List', exact: true }).click();
  await page.getByRole('button', { name: `Configure ${name}`, exact: true }).click();
  await expect(details(page, name)).toBeVisible();
}

const PLAN = {
  summary: 'Firmware work with a lead and a junior.',
  newAgents: [
    { key: 'iot', name: 'Volt', role: 'backend', title: 'Firmware lead', specialty: 'IoT & Embedded', systemPrompt: 'You are Volt.', reason: 'The project is firmware.' },
    { key: 'iot-jr', name: 'Spark', role: 'backend', title: 'Firmware junior', specialty: 'IoT & Embedded', junior: true, mentor: 'iot', reason: 'Small fixes.' },
  ],
  tasks: [
    { id: 't1', title: 'Design firmware layout', description: 'Plan src/greeting.ts changes.', stage: 'architecture', agentId: 'iot', priority: 'high', dependsOn: [] },
    { id: 't2', title: 'Small firmware fix', description: 'Change src/greeting.ts to greet the user.', stage: 'implementation', agentId: 'iot-jr', priority: 'medium', dependsOn: ['t1'] },
  ],
};

function sse(text: string) {
  return [{ type: 'delta', text }, { type: 'done', usage: { inputTokens: 10, outputTokens: 5 }, latencyMs: 1 }].map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
}

test('Sovereign builds the team with a junior under a new senior, and mentors can be changed', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = trapErrors(page);
  await mockProvider(page, 50);
  let planSystem = '';
  const mentorCalls: string[] = [];
  await page.route('**/api/chat', async (route) => {
    const body = route.request().postDataJSON() as { system: string; messages: Array<{ content: string }> };
    const user = body.messages.at(-1)!.content;
    let reply: string;
    if (body.system.includes('Mode: PLAN')) {
      planSystem = body.system;
      reply = JSON.stringify(PLAN);
    } else if (body.system.includes('long-term memory')) {
      reply = JSON.stringify({ lessons: [] });
    } else if (body.system.includes('You are the N+1 senior mentor reviewing')) {
      mentorCalls.push(body.system);
      reply = 'VERDICT: APPROVE\nNOTES: Looks right.';
    }
    else if (body.system.includes('"verdict"')) reply = JSON.stringify({ verdict: 'approve', summary: 'Looks correct.', issues: [] });
    else reply = /Small firmware fix/.test(user) ? "Done.\n```ts path=src/greeting.ts\nexport const greeting = 'Hello, user';\n```" : 'Layout planned.';
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse(reply) });
  });

  await page.goto('/');
  await nav(page, 'Connections');
  await page.getByRole('tab', { name: 'Role defaults' }).click();
  await page.getByRole('button', { name: 'Fill empty roles' }).click();
  await nav(page, 'Workspace');
  await page.getByRole('tab', { name: 'Plan' }).click();
  await expect(page.getByRole('button', { name: 'Team strategy', exact: true })).toContainText('Sovereign designs the team');
  await page.getByRole('textbox', { name: 'Message Sovereign' }).fill('Fix the firmware greeting.');
  await page.getByRole('button', { name: 'Send' }).click();

  const newAgents = page.getByTestId('new-agent');
  await expect(newAgents).toHaveCount(2);
  await expect(newAgents.filter({ hasText: 'Spark' })).toContainText('junior');
  await expect(newAgents.filter({ hasText: 'Spark' })).toContainText('Reports to Volt (N+1 review)');
  expect(planSystem).toContain('There is no limit on the number of agents');
  expect(planSystem).toMatch(/Pulse .*Mentors: Nova/);
  expect(planSystem).toMatch(/Nova .*reports to and is reviewed by Pulse/);

  await page.getByRole('button', { name: 'Approve & run' }).click();
  await expect(page.getByText(/Run completed/)).toBeVisible({ timeout: 30_000 });
  expect(mentorCalls).toHaveLength(1);
  expect(mentorCalls[0]).toContain('You are Volt.');

  await openAgent(page, 'Volt');
  const volt = details(page, 'Volt');
  await expect(volt.getByRole('region', { name: 'Mentors' })).toContainText('Spark');
  await expect(volt.getByTitle('Model')).not.toContainText('No model');
  await volt.getByRole('region', { name: 'Mentors' }).getByRole('button', { name: /Spark/ }).click();
  const spark = details(page, 'Spark');
  await expect(spark.getByRole('button', { name: 'Mentor', exact: true })).toContainText('Volt');
  await expect(spark.getByTitle('Model')).not.toContainText('No model');

  await pick(page, 'Mentor', /^Pulse/);
  await expect(spark.getByRole('button', { name: 'Mentor', exact: true })).toContainText('Pulse');
  await openAgent(page, 'Volt');
  await expect(details(page, 'Volt').getByRole('region', { name: 'Mentors' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('onboarding suggests a matching mentor, and Settings chooses who builds the team', async ({ page }) => {
  const errors = trapErrors(page);
  await mockProvider(page, 50);
  await page.goto('/');
  await nav(page, 'Agents');
  await page.getByRole('button', { name: 'Onboard junior' }).click();
  const dialog = page.getByRole('dialog', { name: 'Onboard a junior agent' });
  await expect(dialog.getByRole('button', { name: 'Mentor', exact: true })).toContainText('Pulse');
  await pick(page, 'Specialty', 'QA');
  await expect(dialog.getByRole('button', { name: 'Mentor', exact: true })).toContainText('Sentinel');
  await expect(dialog.getByText('Suggested for this specialty')).toBeVisible();
  await pick(page, 'Mentor', /Sovereign · direct manager/);
  await dialog.getByRole('textbox').first().fill('Probe');
  await dialog.getByRole('button', { name: 'Onboard' }).click();
  await expect(details(page, 'Probe').getByRole('button', { name: 'Mentor', exact: true })).toContainText('Sovereign');

  await nav(page, 'Settings');
  await expect(page.getByRole('tab', { name: 'Sovereign, automatically' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Only my agents' }).click();
  await expect(page.getByText('never adds new ones')).toBeVisible();
  await nav(page, 'Workspace');
  await page.getByRole('tab', { name: 'Plan' }).click();
  await expect(page.getByRole('button', { name: 'Team strategy', exact: true })).toContainText('Only use my existing agents');
  expect(errors).toEqual([]);
});
