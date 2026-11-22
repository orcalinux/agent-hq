import { expect, test } from '@playwright/test';
import { resetFixtureWorkspace } from '../e2e/fixture';
import { Recorder, SCALE, VIEW } from './recorder';
import { commitFixture, GREETING_PLAN, nav, quickSetup, tidyTerminal, world, type WorldOptions } from './scenario';

test.use({ viewport: VIEW, deviceScaleFactor: SCALE, colorScheme: 'dark' });

test('04 · models and routing', async ({ page }) => {
  test.setTimeout(240_000);
  resetFixtureWorkspace();
  commitFixture();
  const opts: WorldOptions = { plans: [GREETING_PLAN], taskSeconds: 0.2 };
  await world(page, opts);
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

  const rec = new Recorder(page, '04-models');
  await rec.start();
  const section = page.locator('#settings-models');

  await rec.say('where');
  await rec.click(nav(page).getByRole('button', { name: 'Settings', exact: true }));
  await rec.click(page.getByRole('button', { name: 'Models and routing' }).or(page.getByRole('link', { name: 'Models and routing' })).first());
  await rec.hold(0.8);

  await rec.say('order');
  const how = section.getByRole('region', { name: 'How model choice works' });
  await rec.camera(how, 1.7);
  await rec.moveTo(how);

  await rec.say('levels');
  const levels = section.getByRole('list', { name: 'Model for each complexity' });
  await levels.scrollIntoViewIfNeeded();
  await rec.camera(levels, 1.7);
  await rec.moveTo(levels.getByText('Simple', { exact: true }));
  await rec.hold(0.6);
  await rec.moveTo(levels.getByText('Standard', { exact: true }));
  await rec.hold(0.6);
  await rec.moveTo(levels.getByText('Complex', { exact: true }));

  await rec.say('auto');
  await rec.moveTo(section.getByRole('button', { name: 'Simple model', exact: true }));
  await rec.hold(1.5);
  await rec.moveTo(section.getByRole('button', { name: 'Complex model', exact: true }));

  await rec.say('turns');
  await rec.moveTo(levels.getByText('auto · take turns').first());

  await rec.say('pin');
  await rec.pick('Complex model', 'Claude Opus 5.5', section);
  const mode = section.getByRole('tablist', { name: 'Complex level mode' });
  await expect(mode).toBeVisible();

  await rec.say('locked');
  await rec.moveTo(mode.getByRole('tab', { name: 'Preferred' }));
  await rec.hold(1.6);
  await rec.click(mode.getByRole('tab', { name: 'Locked' }));
  await expect(mode.getByRole('tab', { name: 'Locked' })).toHaveAttribute('aria-selected', 'true');

  await rec.say('force');
  const force = section.getByRole('tablist', { name: 'Force my setup' });
  await force.scrollIntoViewIfNeeded();
  await rec.camera(force.locator('xpath=ancestor::div[2]'), 1.7);
  await rec.click(force.getByRole('tab', { name: 'On' }));
  await expect(section.getByText('Your setup always wins')).toBeVisible();
  await rec.camera(section.getByText('Your setup always wins').locator('xpath=ancestor::div[1]'), 1.7);

  await rec.say('forceoff');
  await rec.click(force.getByRole('tab', { name: 'Off' }));
  await rec.camera(null);

  await rec.say('agent');
  await rec.click(nav(page).getByRole('button', { name: 'Agents', exact: true }));
  await rec.click(page.getByRole('tab', { name: 'List', exact: true }));
  await rec.click(page.getByRole('button', { name: 'Configure Titan', exact: true }));
  const titan = page.getByRole('complementary', { name: 'Titan', exact: true });
  await expect(titan).toBeVisible();

  await rec.say('lock');
  const model = titan.getByRole('region', { name: 'Model' });
  await rec.camera(model, 1.7);
  await rec.click(titan.getByRole('button', { name: 'Model', exact: true }));
  await rec.click(page.getByRole('option', { name: 'Claude Haiku 5.5', exact: true }));
  await rec.click(titan.getByRole('tab', { name: 'Always this model' }));
  await expect(titan.getByText('Always: this agent')).toBeVisible();
  await rec.settle(-0.6);
  await page.keyboard.press('Escape');
  await rec.camera(null);

  await rec.say('magpie');
  await rec.click(nav(page).getByRole('button', { name: 'Settings', exact: true }));
  const magpie = section.getByRole('tablist', { name: 'Let Magpie pick the account' });
  await magpie.scrollIntoViewIfNeeded();
  await rec.camera(magpie.locator('xpath=ancestor::div[2]'), 1.6);
  await rec.click(magpie.getByRole('tab', { name: 'On' }));
  await expect(section.getByRole('list', { name: 'Magpie groups' })).toBeVisible();

  await rec.say('quota');
  const groups = section.getByRole('list', { name: 'Magpie groups' });
  await rec.camera(groups, 1.6);
  await rec.hold(2.4);
  const quota = section.getByLabel('Subscription quota');
  await quota.scrollIntoViewIfNeeded();
  await rec.camera(quota, 1.7);
  await rec.moveTo(quota.getByText('7% left'));

  await rec.say('ranking');
  const ranking = section.getByRole('table', { name: 'Model ranking' });
  await ranking.scrollIntoViewIfNeeded();
  await rec.camera(ranking, 1.5);
  await rec.moveTo(ranking.getByRole('row').nth(1));

  await rec.say('decisions');
  const decisions = section.getByRole('table', { name: 'Recent model decisions' });
  await decisions.scrollIntoViewIfNeeded();
  await expect(decisions.getByRole('row')).not.toHaveCount(1);
  await rec.camera(decisions, 1.5);
  await rec.moveTo(decisions.getByRole('row').nth(1));
  await rec.finish();
});
