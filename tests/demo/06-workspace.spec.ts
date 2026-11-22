import { expect, test } from '@playwright/test';
import { resetFixtureWorkspace } from '../e2e/fixture';
import { Recorder, SCALE, VIEW } from './recorder';
import { commitFixture, GREETING_PLAN, nav, quickSetup, read, tidyTerminal, world } from './scenario';

test.use({ viewport: VIEW, deviceScaleFactor: SCALE, colorScheme: 'dark' });

const CHAT = { x: 1040, y: 36, width: 400, height: 760 };
const BOTTOM = { x: 472, y: 560, width: 568, height: 230 };

test('06 · the workspace tools', async ({ page }) => {
  test.setTimeout(240_000);
  resetFixtureWorkspace();
  commitFixture();
  await world(page, { plans: [GREETING_PLAN], taskSeconds: 0.2 });
  await page.goto('/');
  await quickSetup(page);
  await page.getByRole('tab', { name: 'Plan' }).click();
  await page.getByRole('textbox', { name: 'Message Sovereign' }).fill('Greet the user by name and add a subtract helper.');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByRole('button', { name: 'Approve & run' }).last().click();
  await expect(page.getByText(/Run completed and approved by QA/)).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Clear conversation' }).click();
  await page.getByRole('tab', { name: 'Ask' }).click();
  await tidyTerminal(page);
  await page.getByRole('textbox', { name: 'Message Sovereign' }).blur();

  const rec = new Recorder(page, '06-workspace');
  await rec.start();

  await rec.say('explorer');
  await rec.camera({ x: 224, y: 36, width: 816, height: 400 }, 1.6);
  await rec.click(page.getByRole('treeitem', { name: 'src' }).or(page.getByText('src', { exact: true })).first());
  await rec.click(page.getByText('math.ts', { exact: true }).first());
  const editor = page.getByRole('textbox', { name: 'Editing src/math.ts' });
  await expect(editor).toBeVisible();

  await rec.say('edit');
  await rec.camera({ x: 472, y: 36, width: 568, height: 260 }, 1.9);
  await rec.click(editor, { offset: { x: 140, y: 10 } });
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('// Small, pure number helpers.\n', { delay: 45 });
  await rec.hold(0.4);
  await page.keyboard.press('Control+s');
  await expect.poll(() => read('src/math.ts')).toContain('// Small, pure number helpers.');
  await rec.hold(0.6);

  await rec.say('palette');
  await rec.camera(null);
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await rec.camera(palette, 1.5);
  await palette.getByRole('combobox', { name: 'Command' }).or(palette.getByRole('textbox', { name: 'Command' })).first().pressSequentially('greeting', { delay: 70 });
  await rec.hold(0.7);
  await page.keyboard.press('Enter');
  await expect(palette).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Editing src/greeting.ts' })).toBeVisible();
  await rec.camera(null);

  await rec.say('ask');
  await rec.camera(CHAT, 1.5);
  await rec.type(page.getByRole('textbox', { name: 'Message Sovereign' }), 'How is this project organized?');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/holds small number helpers/)).toBeVisible();

  await rec.say('terminal');
  await rec.camera(BOTTOM, 1.7);
  await rec.click(page.getByRole('tab', { name: 'Terminal', exact: true }));
  const terminal = page.getByTestId('integrated-terminal');
  await rec.click(terminal.locator('.xterm-screen').first());
  await page.keyboard.type('git status --short', { delay: 55 });
  await page.keyboard.press('Enter');
  await expect(terminal).toContainText('src/math.ts');

  await rec.say('tabs');
  await rec.click(terminal.getByRole('button', { name: 'New terminal' }));
  await expect(terminal.getByRole('tab')).toHaveCount(2);
  await rec.hold(0.6);

  await rec.say('activity');
  await rec.camera(null);
  await rec.click(page.getByRole('button', { name: 'Activity' }));
  await rec.hold(0.9);
  await rec.camera({ x: 900, y: 36, width: 540, height: 760 }, 1.5);

  await rec.say('reports');
  await rec.click(page.getByRole('button', { name: 'Activity' }));
  await rec.camera(null);
  await rec.click(nav(page).getByRole('button', { name: 'Reports', exact: true }));
  await rec.camera({ x: 224, y: 36, width: 1216, height: 330 }, 1.4);
  await rec.finish();
});
