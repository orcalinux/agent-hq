import { expect, test } from '@playwright/test';
import { resetFixtureWorkspace } from '../e2e/fixture';
import { Recorder, SCALE, VIEW } from './recorder';
import { commitFixture, quickSetup, read, tidyTerminal, world, type ScriptedPlan } from './scenario';

test.use({ viewport: VIEW, deviceScaleFactor: SCALE, colorScheme: 'dark' });

const CHAT = { x: 1040, y: 36, width: 400, height: 760 };
const MULTIPLY = 'export const add = (a: number, b: number) => a + b;\nexport const multiply = (a: number, b: number) => a * b;\n';
const DIVIDE = `${MULTIPLY}export const divide = (a: number, b: number) => {\n  if (b === 0) throw new RangeError('Cannot divide by zero');\n  return a / b;\n};\n`;

const PLANS: ScriptedPlan[] = [
  {
    when: /multiply/i,
    plan: {
      summary: 'Add a multiply helper and show it in the README.',
      tasks: [
        { id: 't1', title: 'Add multiply helper', description: 'Add multiply next to add in src/math.ts.', stage: 'implementation', agentId: 'agent-backend', complexity: 'simple', priority: 'high', dependsOn: [] },
        { id: 't2', title: 'Show it in the README', description: 'Add a usage example to README.md.', stage: 'implementation', agentId: 'agent-architect', complexity: 'simple', priority: 'low', dependsOn: ['t1'] },
      ],
    },
    replies: {
      'Add multiply helper': `Done.\n\`\`\`ts path=src/math.ts\n${MULTIPLY}\`\`\``,
      'Show it in the README': "Done.\n```md path=README.md\n# demo-app\n\nA tiny TypeScript project used in the Agent HQ tutorials.\n\n## Math helpers\n\n- `add(2, 3)` returns 5\n- `multiply(6, 7)` returns 42\n```",
    },
  },
  {
    when: /divide/i,
    plan: {
      summary: 'Add a divide helper that refuses to divide by zero.',
      tasks: [
        { id: 't1', title: 'Add safe divide helper', description: 'Add divide to src/math.ts and throw on zero.', stage: 'implementation', agentId: 'agent-backend', complexity: 'standard', priority: 'high', dependsOn: [] },
      ],
    },
    replies: { 'Add safe divide helper': `Done.\n\`\`\`ts path=src/math.ts\n${DIVIDE}\`\`\`` },
  },
];

test('03 · auto-apply and full access', async ({ page }) => {
  test.setTimeout(240_000);
  resetFixtureWorkspace();
  commitFixture();
  await world(page, { plans: PLANS, taskSeconds: 2.6 });
  await page.goto('/');
  await quickSetup(page);
  await page.getByRole('tab', { name: 'Plan' }).click();
  await tidyTerminal(page);
  await page.getByRole('textbox', { name: 'Message Sovereign' }).blur();

  const rec = new Recorder(page, '03-auto');
  await rec.start();
  const approval = page.getByRole('button', { name: 'Approval mode', exact: true });

  await rec.say('picker');
  await rec.camera({ x: 1040, y: 36, width: 400, height: 260 }, 1.9);
  await rec.click(approval);
  await expect(page.getByRole('option', { name: 'Full access', exact: true })).toBeVisible();

  await rec.say('choose');
  await rec.click(page.getByRole('option', { name: 'Auto-apply changes', exact: true }));
  const autoDialog = page.getByRole('dialog', { name: /Turn on auto-apply/ });
  await expect(autoDialog).toBeVisible();
  await rec.camera(autoDialog, 1.6);

  await rec.say('confirm');
  await rec.hold(2.2);
  await rec.click(autoDialog.getByRole('button', { name: 'Turn on auto-apply' }));
  await expect(autoDialog).toBeHidden();
  await expect(approval).toContainText('Auto-apply changes');

  await rec.say('request');
  await rec.camera(CHAT, 1.5);
  await rec.type(page.getByRole('textbox', { name: 'Message Sovereign' }), 'Add a multiply helper and show it in the README.');
  await rec.click(page.getByRole('button', { name: 'Send' }));
  await expect(page.getByText('Proposed plan · 2 tasks')).toBeVisible();

  await rec.say('approve');
  await rec.click(page.getByRole('button', { name: 'Approve & run' }).last());

  const wrote = page.getByText(/Auto mode wrote 2 file\(s\) to the project/);
  await expect(wrote).toBeVisible({ timeout: 60_000 });
  expect(read('src/math.ts')).toBe(MULTIPLY);
  expect(read('README.md')).toContain('multiply(6, 7)');
  await rec.say('written');
  await rec.camera(wrote, 1.8);

  await rec.say('marked');
  await rec.camera(null);
  await rec.click(page.getByRole('tab', { name: /Changes/ }));
  await rec.camera({ x: 472, y: 560, width: 568, height: 230 }, 1.7);
  const row = (file: string) => page.locator('div.border-b', { has: page.getByText(file, { exact: true }) }).last();
  await expect(row('src/math.ts')).toContainText('auto');
  await rec.moveTo(row('src/math.ts').getByText('auto', { exact: true }));

  await rec.say('full');
  await rec.camera({ x: 1040, y: 36, width: 400, height: 260 }, 1.9);
  await rec.click(approval);
  await rec.click(page.getByRole('option', { name: 'Full access', exact: true }));
  const fullDialog = page.getByRole('dialog', { name: /Turn on full access/ });
  await expect(fullDialog).toBeVisible();
  await rec.camera(fullDialog, 1.6);

  await rec.say('warn');
  await rec.hold(2.4);
  await rec.click(fullDialog.getByRole('button', { name: 'Allow full access' }));
  await expect(fullDialog).toBeHidden();

  await rec.say('build');
  await rec.camera(CHAT, 1.5);
  await rec.click(page.getByRole('tab', { name: 'Build' }));
  await rec.type(page.getByRole('textbox', { name: 'Message Sovereign' }), 'Add a divide helper that refuses to divide by zero.');

  await rec.say('go');
  await rec.click(page.getByRole('button', { name: 'Send' }));
  await expect(page.getByText('Full access is on: running the plan without waiting for approval.')).toBeVisible();

  await rec.say('runs');
  const wroteAgain = page.getByText(/Auto mode wrote 1 file\(s\) to the project/);
  await expect(wroteAgain).toBeVisible({ timeout: 60_000 });
  expect(read('src/math.ts')).toBe(DIVIDE);
  await rec.camera(wroteAgain, 1.8);

  await rec.say('terminal');
  await rec.camera(null);
  await rec.click(page.getByRole('tab', { name: 'Terminal', exact: true }));
  const terminal = page.getByTestId('integrated-terminal');
  await rec.click(terminal.locator('.xterm-screen'));
  await page.keyboard.type('clear; cat src/math.ts', { delay: 45 });
  await page.keyboard.press('Enter');
  await expect(terminal).toContainText('Cannot divide by zero');
  await rec.camera({ x: 472, y: 560, width: 568, height: 230 }, 1.7);

  await rec.say('undo');
  await rec.click(page.getByRole('tab', { name: /Changes/ }));
  await rec.click(row('src/math.ts').getByRole('button', { name: 'Undo' }));
  await expect.poll(() => read('src/math.ts')).toBe(MULTIPLY);
  await expect(row('src/math.ts')).toContainText('reverted');

  await rec.say('back');
  await rec.camera({ x: 1040, y: 36, width: 400, height: 260 }, 1.9);
  await rec.click(approval);
  await rec.click(page.getByRole('option', { name: 'Ask every time', exact: true }));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(approval).toContainText('Ask every time');
  await rec.finish();
});
