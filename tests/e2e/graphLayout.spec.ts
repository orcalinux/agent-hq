import { expect, test } from '@playwright/test';

test('agent graph cards never overlap with a large team, at any window size', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.waitForFunction(() => !!localStorage.getItem('agent-hq.state'));
  const largeTeam = await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('agent-hq.state')!);
    const agents = saved.state.agents as Record<string, { id: string; name: string; role: string }>;
    const templates = Object.values(agents).filter((a) => a.role === 'frontend' || a.role === 'backend');
    for (let i = 0; i < 34; i += 1) {
      const t = templates[i % templates.length];
      const id = `${t.id}-clone-${i}`;
      agents[id] = { ...t, id, name: `${t.name} ${i + 2}` };
    }
    return saved;
  });
  await page.addInitScript((saved) => {
    localStorage.setItem('agent-hq.state', JSON.stringify(saved));
  }, largeTeam);
  await page.reload();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Agents', exact: true }).click();
  await page.getByRole('tab', { name: 'Graph', exact: true }).click();
  await expect(page.locator('button[aria-pressed][data-no-pan]')).toHaveCount(Object.keys(largeTeam.state.agents).length);

  for (const viewport of [{ width: 1440, height: 900 }, { width: 800, height: 700 }]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(300);
    const boxes = await page.locator('button[aria-pressed][data-no-pan]').evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { l: r.left, t: r.top, r: r.right, b: r.bottom };
      }),
    );
    expect(boxes.length).toBeGreaterThan(38);
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        expect(a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t, `cards ${i} and ${j} overlap`).toBe(true);
      }
    }
    await page.screenshot({ path: testInfo.outputPath(`graph-${viewport.width}.png`) });
  }
});
