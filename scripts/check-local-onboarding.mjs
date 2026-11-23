import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium, expect } from '@playwright/test';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hq-onboarding-'));
const workspace = path.join(scratch, 'project');
const recent = path.join(scratch, 'recent-project-with-a-long-name-to-check-truncation');
fs.mkdirSync(workspace);
fs.mkdirSync(recent);
const config = path.join(scratch, 'config');
fs.mkdirSync(config);
fs.writeFileSync(path.join(config, 'config.json'), JSON.stringify({ workspaceRoot: workspace, recentWorkspaces: [workspace, recent], connections: {} }));
process.env.AGENT_HQ_CONFIG_DIR = config;
delete process.env.AGENT_HQ_WORKSPACE;
const localChrome = path.join(os.homedir(), '.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell');
const executablePath = process.env.PLAYWRIGHT_CHROME_PATH || (fs.existsSync(localChrome) ? localChrome : undefined);
const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
const reservation = net.createServer();
await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const child = spawn(process.execPath, ['dist-electron/server.cjs'], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
const server = { url: `http://127.0.0.1:${port}` };
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Local test server did not start.')), 30_000);
  child.stdout.on('data', (data) => {
    if (String(data).includes('Agent HQ is running at')) { clearTimeout(timer); resolve(); }
  });
  child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Local test server exited: ${code}`)); });
  child.once('error', (error) => { clearTimeout(timer); reject(error); });
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
let modelCalls = 0;
const terminalInputs = [];
page.on('request', (request) => { if (request.url().endsWith('/api/chat')) modelCalls++; });
page.on('request', (request) => {
  if (request.url().endsWith('/api/terminal/input')) terminalInputs.push(request.postDataJSON().data);
});
try {
  await page.goto(server.url);
  const start = page.getByTestId('get-started');
  await expect(start).toBeVisible();
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    for (const width of [768, 1000, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), { message: `Document overflow at ${width}` }).toBe(true);
      await expect.poll(() => start.evaluate((element) => element.scrollWidth <= element.clientWidth), { message: `Start screen overflow at ${width}` }).toBe(true);
      await page.screenshot({ path: path.join(scratch, `start-${theme}-${width}.png`) });
    }
  }
  await start.getByRole('button', { name: 'New project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Project', exact: true });
  await expect(dialog.getByRole('tab', { name: 'New project', exact: true })).toHaveAttribute('aria-selected', 'true');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await start.getByRole('button', { name: 'Clone repository', exact: true }).click();
  await expect(dialog.getByRole('tab', { name: 'Clone repo', exact: true })).toHaveAttribute('aria-selected', 'true');
  if (process.argv.includes('--clone')) {
    const folder = dialog.getByRole('textbox', { name: 'Folder path', exact: true });
    await folder.fill(scratch);
    await folder.press('Enter');
    await expect(folder).toHaveValue(scratch);
    await dialog.getByPlaceholder('orcalinux/agent-hq').fill('octocat/Hello-World');
    await dialog.getByRole('button', { name: 'Clone and open', exact: true }).click();
    await expect(dialog).toHaveCount(0, { timeout: 90_000 });
    assert(fs.existsSync(path.join(scratch, 'Hello-World', '.git')), 'Clone did not reach disk');
    await expect(start).toContainText('Hello-World');
    const snapshotResponse = await page.request.post(`${server.url}/api/workers/stage`, {
      data: { runId: 'onboarding', taskId: 'recovery', attempt: 1, files: [{ path: 'onboarding-check.txt', content: 'isolated recovery copy\n' }] },
    });
    assert.equal(snapshotResponse.status(), 200);
    const snapshot = await snapshotResponse.json();
    assert.equal(snapshot.kind, 'worktree');
    assert.equal(fs.readFileSync(path.join(snapshot.path, 'onboarding-check.txt'), 'utf8'), 'isolated recovery copy\n');
    assert.equal(fs.existsSync(path.join(scratch, 'Hello-World', 'onboarding-check.txt')), false);
  } else {
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
  await start.getByRole('button', { name: /recent-project-with-a-long-name/ }).click();
  await expect(start).toContainText(recent);
  const actual = await (await page.request.get(`${server.url}/api/workspace`)).json();
  assert.equal(actual.root, recent);
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Settings', exact: true }).click();
  const updates = page.getByTestId('agent-cli-updates');
  await expect(updates).toContainText('Checked', { timeout: 30_000 });
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    for (const width of [768, 1000, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await updates.scrollIntoViewIfNeeded();
      await expect.poll(() => updates.evaluate((element) => element.scrollWidth <= element.clientWidth), { message: `Update panel overflow at ${width}` }).toBe(true);
      await page.screenshot({ path: path.join(scratch, `updates-${theme}-${width}.png`) });
    }
  }
  const workerSettings = page.getByTestId('worker-isolation-settings');
  await workerSettings.scrollIntoViewIfNeeded();
  await workerSettings.getByRole('tab', { name: 'Proposals only', exact: true }).click();
  await expect(workerSettings.getByRole('tab', { name: 'Proposals only', exact: true })).toHaveAttribute('aria-selected', 'true');
  await workerSettings.getByRole('tab', { name: 'Git worktrees', exact: true }).click();
  await expect(workerSettings.getByRole('tab', { name: 'Git worktrees', exact: true })).toHaveAttribute('aria-selected', 'true');
  const prepare = updates.getByRole('button', { name: /Prepare (install|update)/ }).first();
  if (await prepare.count()) {
    await prepare.scrollIntoViewIfNeeded();
    await prepare.click();
    await expect(page.getByTestId('integrated-terminal')).toBeVisible();
    assert.equal(terminalInputs.length, 1);
    assert(!/[\r\n]/.test(terminalInputs[0]), 'Preparing an update must not execute it');
  }
  const terminalSessions = await (await page.request.get(`${server.url}/api/terminal/sessions`)).json();
  for (const session of terminalSessions.sessions) await page.request.post(`${server.url}/api/terminal/close`, { data: { id: session.id } });
  assert.equal(modelCalls, 0, 'Onboarding must not submit a model prompt');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, cloned: process.argv.includes('--clone'), widths: [768, 1000, 1440], themes: ['light', 'dark'], modelCalls, artifacts: scratch }));
} finally {
  await page.close();
  await browser.close();
  child.kill('SIGTERM');
  await once(child, 'exit');
}
