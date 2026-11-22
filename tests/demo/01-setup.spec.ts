import { expect, test } from '@playwright/test';
import { resetFixtureWorkspace } from '../e2e/fixture';
import { Recorder, SCALE, VIEW } from './recorder';
import { commitFixture, nav, tidyTerminal, world } from './scenario';

test.use({ viewport: VIEW, deviceScaleFactor: SCALE, colorScheme: 'dark' });

test('01 · set up Agent HQ', async ({ page }) => {
  test.setTimeout(240_000);
  resetFixtureWorkspace();
  commitFixture();
  await world(page, { plans: [], connected: [], projectChooser: true });
  await page.goto('/');
  await expect(page.getByText('Pick a model for Sovereign to start.')).toBeVisible();
  await tidyTerminal(page);
  await page.getByRole('textbox', { name: 'Message Sovereign' }).blur();

  const rec = new Recorder(page, '01-setup');
  await rec.start();

  await rec.say('home');
  await rec.camera(page.getByText('Pick a model for Sovereign to start.').locator('xpath=ancestor::div[1]'), 1.5);
  await rec.hold(2.4);
  await rec.camera(null);

  await rec.say('open');
  await rec.click(nav(page).getByRole('button', { name: 'Connections', exact: true }));
  await rec.click(page.getByRole('button', { name: 'Connect provider', exact: true }));
  const wizard = page.getByRole('dialog', { name: 'Connect a provider', exact: true });
  await expect(wizard).toBeVisible();
  await rec.camera(wizard, 1.45);

  await rec.say('provider');
  await rec.click(wizard.getByRole('radio', { name: /Anthropic/ }));
  await rec.hold(0.6);
  await rec.click(wizard.getByRole('button', { name: 'Next', exact: true }));

  await rec.say('method');
  await rec.click(wizard.getByRole('radio', { name: /Signed-in CLI/ }));
  await rec.settle(-1.2);
  await rec.click(wizard.getByRole('button', { name: 'Next', exact: true }));

  await rec.say('verify');
  await rec.hold(0.8);
  await rec.click(wizard.getByRole('button', { name: 'Next', exact: true }));
  await expect(wizard.getByText(/Scripted for this recording/)).toBeVisible();

  await rec.say('save');
  await rec.click(wizard.getByRole('button', { name: 'Save connection', exact: true }));
  await rec.click(wizard.getByRole('button', { name: 'Done', exact: true }));
  await expect(wizard).toBeHidden();
  const providersTable = page.getByRole('table').first();
  await rec.camera(providersTable, 1.35);
  await expect(providersTable.getByRole('row', { name: /Anthropic/ })).toContainText('Connected');

  await rec.say('tools');
  const tools = page.getByRole('table').last();
  await rec.camera(tools, 1.5);
  await rec.hold(1.6);
  await rec.moveTo(tools.getByRole('button', { name: 'Install' }).first());

  await rec.say('roles');
  await rec.camera(null);
  await rec.click(page.getByRole('tab', { name: 'Role defaults' }));
  const fill = page.getByRole('button', { name: 'Fill empty roles' });
  await rec.camera(fill.locator('xpath=ancestor::div[2]'), 1.4);

  await rec.say('fill');
  await rec.click(fill);
  await expect(page.getByText(/Your team is ready/)).toBeVisible();
  await rec.camera(null);

  await rec.say('switcher');
  const switcher = nav(page).getByRole('button', { name: /Projects/ });
  await rec.camera({ x: 0, y: 0, width: 520, height: 300 }, 1.8);
  await rec.click(switcher);
  const dialog = page.getByRole('dialog', { name: 'Project', exact: true });
  await expect(dialog).toBeVisible();
  await rec.camera(dialog, 1.4);

  await rec.say('folder');
  await rec.click(dialog.getByText('demo-app', { exact: true }).first());
  await rec.hold(0.5);
  await rec.click(dialog.getByRole('button', { name: /^Open “/ }));
  await expect(dialog).toBeHidden();
  await rec.camera(null);

  await rec.say('workspace');
  await rec.click(nav(page).getByRole('button', { name: 'Workspace', exact: true }));
  await expect(page.getByText('Pick a model for Sovereign to start.')).toBeHidden();

  await rec.say('ready');
  await rec.camera({ x: 1040, y: 36, width: 400, height: 760 }, 1.7);
  await rec.moveTo(page.getByRole('textbox', { name: 'Message Sovereign' }));
  await rec.finish();
});
