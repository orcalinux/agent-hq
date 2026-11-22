import { expect, test } from '@playwright/test';
import { resetFixtureWorkspace } from '../e2e/fixture';
import { Recorder, SCALE, VIEW } from './recorder';
import { commitFixture, GREETING_PLAN, nav, quickSetup, read, tidyTerminal, world } from './scenario';

test.use({ viewport: VIEW, deviceScaleFactor: SCALE, colorScheme: 'dark' });

const CHAT = { x: 1040, y: 36, width: 400, height: 760 };

test('02 · manual mode', async ({ page }) => {
  test.setTimeout(240_000);
  resetFixtureWorkspace();
  commitFixture();
  const original = read('src/greeting.ts');
  await world(page, { plans: [GREETING_PLAN], taskSeconds: 3.4 });
  await page.goto('/');
  await quickSetup(page);
  await tidyTerminal(page);
  await page.getByRole('textbox', { name: 'Message Sovereign' }).blur();

  const rec = new Recorder(page, '02-manual');
  await rec.start();

  await rec.say('mode');
  await rec.click(page.getByRole('tab', { name: 'Plan' }), { pause: 0.1 });
  await rec.camera({ x: 1040, y: 36, width: 400, height: 150 }, 1.9);
  await rec.moveTo(page.getByRole('button', { name: 'Approval mode', exact: true }));

  await rec.say('plan');
  await rec.moveTo(page.getByRole('tab', { name: 'Plan' }));
  await rec.hold(1.2);
  await rec.camera(CHAT, 1.5);

  await rec.say('type');
  await rec.type(page.getByRole('textbox', { name: 'Message Sovereign' }), 'Greet the user by name, and add a subtract helper next to add.');

  await rec.say('send');
  await rec.click(page.getByRole('button', { name: 'Send' }));
  await expect(page.getByText('Proposed plan · 3 tasks')).toBeVisible();
  const task = (title: string) => page.getByRole('listitem').filter({ has: page.getByText(title, { exact: true }) }).last();
  await task('Update greeting').scrollIntoViewIfNeeded();

  await rec.say('card');
  await rec.camera(CHAT, 1.5);
  await rec.hold(1.5);
  await rec.moveTo(page.getByText('Proposed plan · 3 tasks'));

  await rec.say('level');
  await rec.camera(task('Update greeting'), 1.9);
  await rec.moveTo(page.getByLabel('Complexity for Update greeting').last());

  await rec.say('reason');
  await rec.camera(task('Add subtract helper'), 1.9);
  await rec.moveTo(page.getByLabel('Model for Add subtract helper').last());

  await rec.say('deps');
  await rec.camera(task('Document the changes'), 1.9);
  await rec.moveTo(task('Document the changes').getByText(/after t1, t2/));

  await rec.say('approve');
  const approve = page.getByRole('button', { name: 'Approve & run' }).last();
  await rec.camera(approve.locator('xpath=ancestor::div[2]'), 1.8);
  await rec.settle(-1.4);
  await rec.click(approve);
  await rec.camera(null);

  await rec.say('board');
  await rec.click(nav(page).getByRole('button', { name: 'Tasks', exact: true }));

  await expect(page.getByText(/Run completed and approved by QA/)).toBeHidden();
  await rec.say('qa');
  await rec.camera({ x: 950, y: 60, width: 490, height: 500 }, 1.5);
  await expect(page.getByText('4/4 done', { exact: false })).toBeVisible({ timeout: 60_000 });

  await rec.say('back');
  await rec.camera(null);
  await rec.click(nav(page).getByRole('button', { name: 'Workspace', exact: true }));
  const done = page.getByText(/Run completed and approved by QA/);
  await expect(done).toBeVisible();
  await rec.camera(done, 1.8);

  await rec.say('pending');
  await rec.camera(null);
  await rec.click(page.getByRole('tab', { name: /Changes/ }));
  const changes = { x: 472, y: 560, width: 568, height: 230 };
  await rec.camera(changes, 1.7);
  const row = (file: string) => page.locator('div.border-b', { has: page.getByText(file, { exact: true }) }).last();
  await expect(row('src/greeting.ts')).toContainText('pending');
  expect(read('src/greeting.ts'), 'nothing is written before Apply').toBe(original);

  await rec.say('diff');
  await rec.click(row('src/greeting.ts').getByRole('button', { name: 'Diff' }));
  await expect(page.getByText(/Saved file ↔ agent proposal/)).toBeVisible();
  await rec.camera({ x: 472, y: 36, width: 568, height: 200 }, 1.9);

  await rec.say('apply');
  await rec.camera(changes, 1.7);
  await rec.click(row('src/greeting.ts').getByRole('button', { name: 'Apply' }));
  await expect(row('src/greeting.ts')).toContainText('applied');
  await expect.poll(() => read('src/greeting.ts')).toContain('Hello, ${name}!');

  await rec.say('applied');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await rec.camera({ x: 472, y: 560, width: 568, height: 230 }, 1.6);
  await rec.hold(1.2);
  await rec.moveTo(row('src/greeting.ts').getByText('applied'));

  await rec.say('undo');
  await rec.click(row('src/greeting.ts').getByRole('button', { name: 'Undo' }));
  await expect.poll(() => read('src/greeting.ts')).toBe(original);
  await expect(row('src/greeting.ts')).toContainText('reverted');

  await rec.say('rest');
  await rec.click(row('src/math.ts').getByRole('button', { name: 'Apply' }));
  await expect.poll(() => read('src/math.ts')).toContain('subtract');
  await rec.click(row('docs/CHANGES.md').getByRole('button', { name: 'Discard proposal' }));
  await expect(row('docs/CHANGES.md')).toContainText('discarded');
  expect(read('docs/CHANGES.md'), 'a discarded proposal is never written').toBeNull();
  await rec.camera(null);
  await rec.finish();
});
