import { expect, test } from '@playwright/test';

const releaseApi = 'https://api.github.com/repos/orcalinux/agent-hq/releases/latest';
const releaseBase = 'https://github.com/orcalinux/agent-hq/releases/download/v1.2.3/';
const names = [
  'Agent-HQ-1.2.3-linux-amd64.deb',
  'Agent-HQ-1.2.3-linux-x86_64.rpm',
  'Agent-HQ-1.2.3-linux-x86_64.AppImage',
  'Agent-HQ-1.2.3-mac-arm64.dmg',
  'Agent-HQ-1.2.3-mac-x64.dmg',
  'Agent-HQ-1.2.3-win-x64.exe',
  'SHA256SUMS.txt',
];

test.beforeEach(async ({ page }) => {
  await page.route(releaseApi, (route) => route.fulfill({
    json: { tag_name: 'v1.2.3', assets: names.map((name) => ({ name, browser_download_url: `${releaseBase}${name}` })) },
  }));
});

for (const width of [320, 375, 650, 768, 900, 1024, 1440, 1920]) {
  test(`all sections fit at ${width}px without horizontal scrolling`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    for (const section of ['#product', '#workflow', '.control-section', '.open-section', '#questions', '#download']) {
      await page.locator(section).scrollIntoViewIfNeeded();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    for (const tab of ['Workspace', 'Tasks', 'Office', 'Growth']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      const panel = page.getByRole('tabpanel');
      await expect(panel).toBeVisible();
      await expect.poll(() => panel.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    }
    expect(errors).toEqual([]);
  });
}

test('tour supports keyboard navigation and the screenshot dialog restores focus', async ({ page }) => {
  await page.goto('/');
  const workspace = page.getByRole('tab', { name: 'Workspace', exact: true });
  await workspace.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Tasks', exact: true })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Tasks', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(page.getByRole('tabpanel')).toHaveAttribute('id', 'panel-growth');
  const expand = page.getByRole('button', { name: 'Expand growth screenshot' });
  await expand.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('img')).toHaveAttribute('src', /growth\.png$/);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(expand).toBeFocused();
  await expand.click();
  await dialog.getByRole('button', { name: 'Close screenshot' }).click();
  await expect(dialog).toBeHidden();
});

test('mobile navigation closes on selection, outside click, and Escape', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  const toggle = page.locator('.mobile-toggle');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav).toBeHidden();
  await toggle.click();
  await expect(nav).toBeVisible();
  await nav.getByRole('link', { name: 'Product', exact: true }).click();
  await expect(nav).toBeHidden();
  await toggle.click();
  await page.keyboard.press('Escape');
  await expect(nav).toBeHidden();
  await expect(toggle).toBeFocused();
  await toggle.click();
  await page.getByRole('heading', { name: /See the whole picture/ }).click();
  await expect(nav).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(nav).toBeVisible();
});

test('release metadata resolves every architecture to its correct asset', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-release-label]')).toHaveText('Latest release / v1.2.3');
  const keys = ['deb', 'rpm', 'appimage', 'mac-arm', 'mac-intel', 'windows'];
  for (const [index, key] of keys.entries()) {
    await expect(page.locator(`[data-asset="${key}"]`)).toHaveAttribute('href', releaseBase + names[index]);
  }
  await expect(page.locator('[data-checksums]')).toHaveAttribute('href', releaseBase + 'SHA256SUMS.txt');
});

test('failed release lookups retain working fallback links', async ({ page }) => {
  await page.route(releaseApi, (route) => route.fulfill({ status: 503, body: 'Unavailable' }));
  await page.goto('/');
  await expect(page.locator('#download-note')).toContainText('Could not load');
  for (const link of await page.locator('[data-asset]').all()) {
    await expect(link).toHaveAttribute('href', 'https://github.com/orcalinux/agent-hq/releases/latest');
  }
});

test('untrusted release asset URLs cannot replace download links', async ({ page }) => {
  await page.route(releaseApi, (route) => route.fulfill({
    json: { tag_name: 'v1.2.3', assets: [{ name: names[0], browser_download_url: 'https://example.com/untrusted.deb' }] },
  }));
  await page.goto('/');
  await expect(page.locator('[data-release-label]')).toContainText('v1.2.3');
  await expect(page.locator('[data-asset="deb"]')).toHaveAttribute('href', 'https://github.com/orcalinux/agent-hq/releases/latest');
});

test('motion can be paused and respects a changing reduced-motion preference', async ({ page }) => {
  await page.goto('/');
  const toggle = page.getByRole('button', { name: 'Pause animation' });
  await toggle.click();
  await expect(page.getByRole('button', { name: 'Play animation' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.locator('.task-line i').first().evaluate((element) => getComputedStyle(element).animationPlayState)).toBe('paused');
  await page.getByRole('button', { name: 'Play animation' }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.motion-toggle')).toBeHidden();
  await expect.poll(() => page.locator('.task-line i').first().evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
  await page.locator('#download').scrollIntoViewIfNeeded();
  await expect(page.locator('.download-heading')).toHaveCSS('opacity', '1');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('.mission-preview')).toHaveClass(/motion-paused/);
});

test('FAQ works with keyboard and content remains available without JavaScript', async ({ page, browser }) => {
  await page.goto('/');
  const question = page.locator('summary').filter({ hasText: 'Is Agent HQ free?' });
  await question.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('The application is free and open source under the MIT license.')).toBeVisible();
  const noScript = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 375, height: 812 } });
  await noScript.goto('http://127.0.0.1:4180/');
  await expect(noScript.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  await expect(noScript.getByRole('link', { name: 'View Tasks', exact: true })).toBeVisible();
  await expect(noScript.locator('[data-asset="deb"]')).toHaveAttribute('href', /releases\/latest$/);
  await noScript.close();
});
