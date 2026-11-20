import { expect, test, type Page } from '@playwright/test';
import { resetFixtureWorkspace } from './fixture';
import { mockProvider, trapErrors } from './mocks';

test.beforeEach(() => resetFixtureWorkspace());

const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name, exact: true }).click();
const card = (page: Page, name: string) => page.getByRole('article', { name: `${name} growth` });

async function teach(page: Page, lessons: Array<{ agentId: string; kind: string; text: string; source?: string }>) {
  const res = await page.request.post('/api/memory/lessons', { data: { lessons: lessons.map((l) => ({ source: 'user', ...l })) } });
  expect(res.ok()).toBe(true);
}

test('growth shows each agent\'s level, focus areas and recent learning, and opens its memory', async ({ page }) => {
  const errors = trapErrors(page);
  await mockProvider(page, 50);
  await teach(page, [
    { agentId: 'agent-frontend', kind: 'convention', text: 'Style buttons with Tailwind classes, never inline styles.' },
    { agentId: 'agent-frontend', kind: 'pitfall', text: 'Tailwind tokens for buttons live in src/styles/globals.css.', source: 'qa' },
    { agentId: 'agent-frontend', kind: 'decision', text: 'Dialogs reuse the shared Dialog component and its motion.' },
    { agentId: 'agent-backend', kind: 'fact', text: 'Database migrations live in db/migrations.' },
    { agentId: 'team', kind: 'preference', text: 'Keep commit messages short and in the imperative.' },
  ]);
  await teach(page, [{ agentId: 'agent-frontend', kind: 'convention', text: 'Style buttons with Tailwind classes, never inline styles.' }]);

  await page.goto('/');
  await nav(page, 'Growth');
  await expect(page.getByTestId('growth-card')).toHaveCount(7);
  await expect(page.getByTestId('growth-card').first()).toHaveAttribute('aria-label', 'Pulse growth');
  const pulse = card(page, 'Pulse');
  await expect(pulse.getByText('Learning', { exact: true })).toBeVisible();
  await expect(pulse.getByTestId('growth-level')).toContainText('points to Practiced');
  await expect(pulse.getByRole('list', { name: 'Pulse focus areas' })).toContainText('tailwind');
  await expect(pulse.getByRole('list', { name: 'Lessons by kind' })).toContainText('Pitfall');
  await expect(pulse.getByText('1 from reviews')).toBeVisible();
  await expect(card(page, 'Aegis').getByText('Newcomer', { exact: true })).toBeVisible();

  const totals = page.getByTestId('growth-totals');
  await expect(totals).toContainText('Lessons learned5');
  await expect(totals).toContainText('Most experiencedPulse');
  await expect(page.getByTestId('growth-feed').getByRole('listitem')).toHaveCount(5);
  await expect(page.getByTestId('growth-feed')).toContainText('Whole team');

  await page.getByRole('tab', { name: 'Name' }).click();
  await expect(page.getByTestId('growth-card').first()).toHaveAttribute('aria-label', 'Aegis growth');

  await nav(page, 'Workspace');
  await page.keyboard.press('Alt+6');
  await expect(page.getByRole('main', { name: 'growth' })).toBeVisible();

  await card(page, 'Pulse').getByRole('button', { name: "Open Pulse's memory" }).click();
  await expect(page.getByRole('main', { name: 'agents' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Memory' }).getByTestId('lesson')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('growth explains how agents learn before there are any lessons', async ({ page }) => {
  const errors = trapErrors(page);
  await mockProvider(page, 50);
  await page.goto('/');
  await nav(page, 'Reports');
  await page.getByRole('button', { name: 'Open Growth' }).click();
  await expect(page.getByTestId('growth-empty')).toContainText('No lessons yet');
  await expect(page.getByTestId('growth-card')).toHaveCount(7);
  await expect(page.getByTestId('growth-card').filter({ hasText: 'Newcomer' })).toHaveCount(7);
  await expect(page.getByTestId('growth-totals')).toContainText('Most experienced—');
  expect(errors).toEqual([]);
});
