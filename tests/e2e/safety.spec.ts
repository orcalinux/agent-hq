import { expect, test } from '@playwright/test';
import { resetFixtureWorkspace } from './fixture';

const nav = (page: import('@playwright/test').Page, view: string) =>
  page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: view, exact: true }).click();

test('run limits are edited in Settings and survive a reload', async ({ page }, testInfo) => {
  await page.goto('/');
  await nav(page, 'Settings');
  const cost = page.getByRole('spinbutton', { name: /Cost per run/ });
  await expect(cost).toHaveValue('10');
  await cost.fill('2.5');
  await cost.press('Enter');
  const calls = page.getByRole('spinbutton', { name: /Model calls per agent/ });
  await calls.fill('');
  await calls.blur();
  await page.locator('#settings-limits').screenshot({ path: testInfo.outputPath('run-limits.png') });
  await page.reload();
  await nav(page, 'Settings');
  await expect(page.getByRole('spinbutton', { name: /Cost per run/ })).toHaveValue('2.5');
  await expect(page.getByRole('spinbutton', { name: /Model calls per agent/ })).toHaveValue('');
  await page.getByRole('button', { name: 'Restore defaults' }).click();
  await expect(page.getByRole('spinbutton', { name: /Model calls per agent/ })).toHaveValue('60');
});

test('Changes shows a real diff and flags files that independent tasks both changed', async ({ page }, testInfo) => {
  resetFixtureWorkspace();
  await page.goto('/');
  await page.waitForFunction(() => !!localStorage.getItem('agent-hq.state'));
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('agent-hq.state')!);
    const task = (id: string, agent: string) => ({ id, title: `Edit ${id}`, description: '', stage: 'implementation', assignedAgentId: agent, status: 'completed', priority: 'medium', progress: 100, tags: [], dependsOn: [] });
    const change = (id: string, path: string, content: string, taskId: string, conflictsWith?: string[]) => ({ id, path, content, taskId, agentId: 'agent-frontend', status: 'pending', conflictsWith });
    saved.state.activeMission = {
      id: 'run-safety', presetId: 'custom', source: 'live', title: 'Safety', prompt: 'x', status: 'completed', startedAt: Date.now(), currentStage: 'shipped', stageIndex: 4,
      tasks: [task('ui', 'agent-frontend'), task('api', 'agent-backend')],
      proposedChanges: [
        change('ui:src/math.ts', 'src/math.ts', 'export const add = (a: number, b: number) => a + b;\nexport const double = (a: number) => a * 2;\n', 'ui', ['api']),
        change('api:src/math.ts', 'src/math.ts', 'export const add = (a: number, b: number) => a + b;\nexport const subtract = (a: number, b: number) => a - b;\n', 'api', ['ui']),
        change('ui:src/new.ts', 'src/new.ts', 'export const fresh = true;\n', 'ui'),
      ],
    };
    localStorage.setItem('agent-hq.state', JSON.stringify(saved));
  });
  await page.reload();
  await nav(page, 'Workspace');
  await page.getByRole('tab', { name: /Changes/ }).click();
  const conflictBadges = page.getByText('conflict', { exact: true });
  await expect(conflictBadges).toHaveCount(2);

  await page.getByRole('button', { name: 'Show changes' }).first().click();
  const diff = page.getByTestId('proposal-diff');
  await expect(diff).toContainText('Compared with the file on disk');
  await expect(diff).toContainText('+1');
  await expect(diff).toContainText('−0');
  await expect(diff).toContainText('export const double');
  await page.getByTestId('proposal-diff').locator('xpath=ancestor::div[contains(@class,"overflow-y-auto")][1]').screenshot({ path: testInfo.outputPath('changes-diff.png') });

  await page.getByRole('button', { name: 'Apply' }).first().click();
  await expect(conflictBadges).toHaveCount(0);
  await expect(page.getByText('discarded', { exact: true })).toHaveCount(1);
});

test('an unfinished run saved on the server comes back after browser storage is wiped', async ({ page }) => {
  resetFixtureWorkspace();
  await page.goto('/');
  const mission = {
    id: 'run-journal', presetId: 'custom', source: 'live', title: 'Journal survivor', prompt: 'x', status: 'running', startedAt: Date.now(), currentStage: 'implementation', stageIndex: 2,
    tasks: [
      { id: 'done', title: 'Finished task', description: '', stage: 'implementation', assignedAgentId: 'agent-frontend', status: 'completed', priority: 'medium', progress: 100, tags: [], dependsOn: [], output: 'kept' },
      { id: 'mid', title: 'Mid-flight task', description: '', stage: 'implementation', assignedAgentId: 'agent-backend', status: 'in_progress', priority: 'medium', progress: 40, tags: [], dependsOn: [] },
    ],
  };
  const saved = await page.request.put('/api/runs/journal', { data: { mission } });
  expect(saved.ok()).toBe(true);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('agent-hq.state') ?? '{}').state?.activeMission?.id)).toBe('run-journal');
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('agent-hq.state')!).state.activeMission);
  expect(restored).toMatchObject({ status: 'cancelled', interrupted: true });
  expect(restored.tasks.map((task: { status: string }) => task.status)).toEqual(['completed', 'pending']);
  const cleared = await page.request.delete('/api/runs/journal');
  expect(cleared.ok()).toBe(true);
});
