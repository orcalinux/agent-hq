import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';
import { E2E_WORKSPACE, resetFixtureWorkspace } from '../e2e/fixture';
import { Recorder, SCALE, VIEW } from './recorder';
import { commitFixture, nav, quickSetup, seedLessons, tidyTerminal, world, type ScriptedPlan } from './scenario';

test.use({ viewport: VIEW, deviceScaleFactor: SCALE, colorScheme: 'dark' });

const CHAT = { x: 1040, y: 36, width: 400, height: 760 };

const HIRE: ScriptedPlan = {
  when: /validation/i,
  plan: {
    summary: 'Validate the math helpers and cover them with unit tests.',
    newAgents: [
      { key: 'vera', name: 'Vera', role: 'backend', title: 'Test lead', specialty: 'Input validation & testing', systemPrompt: 'You are Vera, a test lead.', reason: 'No one on the team specializes in validation and tests.' },
      { key: 'kit', name: 'Kit', role: 'backend', title: 'Junior test engineer', specialty: 'Input validation & testing', junior: true, mentor: 'vera', systemPrompt: 'You are Kit.', reason: 'Small, well-scoped test work.' },
    ],
    tasks: [
      { id: 't1', title: 'Add input validation', description: 'Reject non-finite numbers in src/math.ts.', stage: 'implementation', agentId: 'vera', complexity: 'standard', priority: 'high', dependsOn: [] },
      { id: 't2', title: 'Write unit tests', description: 'Cover add and subtract in src/math.test.ts.', stage: 'implementation', agentId: 'kit', complexity: 'simple', priority: 'medium', dependsOn: ['t1'] },
    ],
  },
  replies: {
    'Add input validation': "Done.\n```ts path=src/math.ts\nconst check = (n: number) => {\n  if (!Number.isFinite(n)) throw new TypeError(`Expected a finite number, got ${n}`);\n  return n;\n};\n\nexport const add = (a: number, b: number) => check(a) + check(b);\n```",
    'Write unit tests': "Done.\n```ts path=src/math.test.ts\nimport { add } from './math';\n\ntest('adds', () => expect(add(2, 3)).toBe(5));\ntest('rejects NaN', () => expect(() => add(NaN, 1)).toThrow());\n```",
  },
};

test('05 · a team that grows', async ({ page }) => {
  test.setTimeout(240_000);
  resetFixtureWorkspace();
  commitFixture();
  seedLessons();
  await world(page, { plans: [HIRE], taskSeconds: 2.4 });
  await page.goto('/');
  await quickSetup(page);
  await page.getByRole('tab', { name: 'Plan' }).click();
  await tidyTerminal(page);
  await page.getByRole('textbox', { name: 'Message Sovereign' }).blur();

  const rec = new Recorder(page, '05-team');
  await rec.start();

  await rec.say('strategy');
  const team = page.getByRole('button', { name: 'Team strategy', exact: true });
  await expect(team).toContainText('Sovereign designs the team');
  await rec.camera({ x: 1040, y: 36, width: 400, height: 200 }, 1.9);
  await rec.moveTo(team);

  await rec.say('ask');
  await rec.camera(CHAT, 1.5);
  await rec.type(page.getByRole('textbox', { name: 'Message Sovereign' }), 'Add input validation to the math helpers, with unit tests.');
  await rec.click(page.getByRole('button', { name: 'Send' }));
  const hires = page.getByTestId('new-agent');
  await expect(hires).toHaveCount(2);
  await hires.first().scrollIntoViewIfNeeded();

  await rec.say('hires');
  await rec.camera(hires.first().locator('xpath=..'), 1.8);
  await rec.moveTo(hires.filter({ hasText: 'Vera' }));
  await rec.hold(1.6);
  await rec.moveTo(hires.filter({ hasText: 'Kit' }).getByText(/Reports to Vera/));
  await expect(hires.filter({ hasText: 'Kit' })).toContainText('Reports to Vera (N+1 review)');

  await rec.say('why');
  await rec.moveTo(page.getByRole('button', { name: 'Model for Vera' }));
  await rec.hold(1.2);
  await rec.moveTo(hires.filter({ hasText: 'Vera' }).getByText(/No one on the team/));

  await rec.say('approve');
  await rec.camera(CHAT, 1.5);
  await rec.click(page.getByRole('button', { name: 'Approve & run' }).last());

  await rec.say('review');
  await rec.camera(null);
  await rec.click(nav(page).getByRole('button', { name: 'Tasks', exact: true }));
  await expect(page.getByText(/2\/2 done|3\/3 done/)).toBeVisible({ timeout: 60_000 });

  await rec.say('graph');
  await rec.click(nav(page).getByRole('button', { name: 'Agents', exact: true }));
  await rec.click(page.getByRole('tab', { name: 'Graph', exact: true }));
  await expect(page.getByText('Kit', { exact: true }).first()).toBeVisible();
  await rec.hold(0.8);
  await rec.moveTo(page.getByText('Kit', { exact: true }).first());

  await rec.say('onboard');
  await rec.click(page.getByRole('button', { name: 'Onboard junior' }));
  const dialog = page.getByRole('dialog', { name: 'Onboard a junior agent' });
  await expect(dialog).toBeVisible();
  await rec.camera(dialog, 1.5);

  await rec.say('specialty');
  await rec.pick('Specialty', 'QA');
  await expect(dialog.getByRole('button', { name: 'Mentor', exact: true })).toContainText('Sentinel');
  await rec.moveTo(dialog.getByRole('button', { name: 'Mentor', exact: true }));

  await rec.say('name');
  await rec.type(dialog.getByRole('textbox').first(), 'Probe');
  await rec.click(dialog.getByRole('button', { name: 'Onboard' }));
  const probe = page.getByRole('complementary', { name: 'Probe', exact: true });
  await expect(probe.getByRole('button', { name: 'Mentor', exact: true })).toContainText('Sentinel');
  await rec.camera(probe, 1.4);
  await rec.settle(-0.5);
  await page.keyboard.press('Escape');
  await rec.camera(null);

  await rec.say('growth');
  await rec.click(nav(page).getByRole('button', { name: 'Growth', exact: true }));
  await rec.camera({ x: 224, y: 56, width: 1216, height: 110 }, 1.5);

  await rec.say('card');
  await rec.camera({ x: 236, y: 196, width: 400, height: 440 }, 1.8);
  await rec.moveTo(page.getByText('Focus areas').first());

  await rec.say('teach');
  await rec.camera(null);
  await rec.click(nav(page).getByRole('button', { name: 'Workspace', exact: true }));
  await rec.camera(CHAT, 1.5);
  await rec.type(page.getByRole('textbox', { name: 'Message Sovereign' }), '/remember Keep math helpers pure, with no side effects.');
  await page.keyboard.press('Enter');
  await expect.poll(() => fs.readFileSync(path.join(E2E_WORKSPACE, '.agent-hq/memory/lessons.json'), 'utf8')).toContain('Keep math helpers pure');
  await rec.finish();
});
