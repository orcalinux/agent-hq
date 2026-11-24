// Checks desktop access end to end against the real Cua Driver, on a private Xvfb display with its own D-Bus and
// a throwaway GTK window, so nothing touches your desktop. Uses the built server and a throwaway config.
// No model calls unless --model EXACT_CODEX_MODEL is supplied; that also checks a real UI-generated run.
// Needs: npm run build:electron, cua-driver on PATH, Xvfb, dbus-daemon, at-spi2-core and python3 with GTK 3.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium, expect } from '@playwright/test';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hq-computer-'));
const modelIndex = process.argv.indexOf('--model');
const model = modelIndex < 0 ? null : process.argv[modelIndex + 1];
if (modelIndex >= 0 && (!model || /^(default|group\/)/.test(model))) throw new Error('Choose an exact signed-in Codex model.');
const children = [];
const start = (command, args, options = {}) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  children.push(child);
  return child;
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (what, check, ms = 15_000) => {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await wait(200);
  }
};

const display = `:${200 + Math.floor(Math.random() * 400)}`;
start('Xvfb', [display, '-screen', '0', '1280x800x24', '-nolisten', 'tcp']);
await wait(800);
const bus = start('dbus-daemon', ['--session', '--nofork', '--print-address=1']);
const address = await new Promise((resolve, reject) => {
  bus.stdout.once('data', (data) => resolve(String(data).trim()));
  bus.once('exit', () => reject(new Error('dbus-daemon exited')));
});
const env = { ...process.env, DISPLAY: display, DBUS_SESSION_BUS_ADDRESS: address, NO_AT_BRIDGE: '0', GTK_MODULES: 'gail:atk-bridge', CUA_DRIVER_RS_TELEMETRY_ENABLED: '0' };
delete env.WAYLAND_DISPLAY;
start('/usr/libexec/at-spi-bus-launcher', ['--launch-immediately'], { env });
await wait(800);
fs.writeFileSync(path.join(scratch, 'fixture.py'), `import gi
gi.require_version('Gtk', '3.0')
from gi.repository import Gtk
w = Gtk.Window(title="Agent HQ fixture"); box = Gtk.Box(orientation=1); entry = Gtk.Entry(); label = Gtk.Label(label="count 0"); n = [0]
def clicked(_):
    n[0] += 1; label.set_text("count %d text %s" % (n[0], entry.get_text())); print(label.get_text(), flush=True)
button = Gtk.Button(label="Increment"); button.connect("clicked", clicked)
for widget in (entry, button, label): box.add(widget)
w.add(box); w.connect("destroy", Gtk.main_quit); w.show_all(); Gtk.main()
`);
const fixture = start('python3', [path.join(scratch, 'fixture.py')], { env });
let fixtureOut = '';
fixture.stdout.on('data', (data) => { fixtureOut += String(data); });

const config = path.join(scratch, 'config');
const workspace = path.join(scratch, 'project');
fs.mkdirSync(config);
fs.mkdirSync(workspace);
fs.writeFileSync(path.join(config, 'config.json'), JSON.stringify({ workspaceRoot: workspace, connections: model ? { openai: { providerId: 'openai', method: 'cli', connectedAt: new Date().toISOString() } } : {} }), { mode: 0o600 });
const reservation = net.createServer();
await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const server = start(process.execPath, ['dist-electron/server.cjs'], { env: { ...env, AGENT_HQ_CONFIG_DIR: config, PORT: String(port), AGENT_HQ_WORKSPACE: '' } });
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Server did not start')), 30_000);
  server.stdout.on('data', (data) => { if (String(data).includes('Agent HQ is running at')) { clearTimeout(timer); resolve(); } });
  server.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Server exited: ${code}`)); });
});
const url = `http://127.0.0.1:${port}`;
const api = async (method, route, body) => {
  const res = await fetch(url + route, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
};
const call = (name, args) => api('POST', '/api/computer/call', { name, arguments: args });
const ownedDirs = () => fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('ahq-cua-'));
const steps = [];
const step = (text) => { steps.push(text); console.log(`ok  ${text}`); };

try {
  const dirsBefore = new Set(ownedDirs());
  let status = (await api('GET', '/api/computer/status')).data;
  assert.equal(status.installed, true, 'cua-driver is not on PATH');
  assert.equal(status.access, 'off');
  assert.equal(status.running, false);
  assert.equal(status.ready, true, `Driver not ready on the private display: ${JSON.stringify(status.probes)}`);
  step(`driver ${status.version} is ready, access is off by default and nothing runs`);
  assert.deepEqual((await api('GET', '/api/computer/tools')).data.tools, []);
  assert.notEqual((await call('list_windows', {})).status, 200);
  step('with access off no tools are offered and calls are refused');

  status = (await api('PUT', '/api/computer/access', { access: 'read' })).data;
  assert.equal(status.running, true);
  const readTools = (await api('GET', '/api/computer/tools')).data.tools;
  assert.deepEqual(readTools.map((tool) => tool.name).sort(), ['get_window_state', 'list_apps', 'list_windows']);
  for (const tool of readTools) for (const key of ['session', 'include_screenshot', 'screenshot_out_file', 'x', 'y']) assert(!(key in tool.schema.properties), `${tool.name} offers ${key}`);
  step('read access starts a private driver and offers three read tools without screenshot, file or session arguments');

  const windows = await until('the fixture window', async () => {
    const { data } = await call('list_windows', {});
    return data.result?.windows?.find((window) => window.title === 'Agent HQ fixture');
  });
  const read = async () => (await call('get_window_state', { pid: windows.pid, window_id: windows.window_id })).data.result;
  let tree = await read();
  assert.match(tree.tree_markdown, /button "Increment"/);
  assert.equal(tree.screenshot, undefined);
  const token = (pattern) => `${tree.snapshot_id}:${tree.tree_markdown.match(pattern)[1]}`;
  step('reads the fixture window as an accessibility tree, with no screenshot');
  const refused = await call('click', { pid: windows.pid, element_token: token(/\[(\d+)\] button "Increment"/) });
  assert.notEqual(refused.status, 200);
  assert.equal(fixtureOut, '');
  step('read access refuses clicks, and the fixture saw none');

  await api('PUT', '/api/computer/access', { access: 'control' });
  assert.equal((await api('GET', '/api/computer/tools')).data.tools.length, 8);
  tree = await read();
  const typed = await call('type_text', { pid: windows.pid, element_token: token(/\[(\d+)\] text/), text: 'hello' });
  assert.equal(typed.status, 200, JSON.stringify(typed.data));
  const clicked = await call('click', { pid: windows.pid, element_token: token(/\[(\d+)\] button "Increment"/) });
  assert.equal(clicked.status, 200, JSON.stringify(clicked.data));
  await until('the click to reach the fixture', () => fixtureOut.includes('count 1 text hello'));
  step('control access types into the field and clicks the button through tokens from a separate read');
  for (const [name, args] of [['click', { pid: windows.pid, x: 10, y: 10 }], ['get_window_state', { pid: windows.pid, include_screenshot: true }], ['list_apps', { session: 'someone-else' }], ['run_steps', {}]]) {
    const res = await call(name, args);
    assert.notEqual(res.status, 200, `${name} ${JSON.stringify(args)} was allowed`);
  }
  assert.equal(fixtureOut.trim().split('\n').length, 1);
  step('pixel clicks, screenshots, foreign sessions and unlisted tools are refused');
  const concurrent = await Promise.all([read(), read(), read()]);
  assert(concurrent.every((state) => /Increment/.test(state.tree_markdown)));
  step('concurrent calls are served one at a time without errors');

  const installedChrome = path.join(os.homedir(), '.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROME_PATH || (fs.existsSync(installedChrome) ? installedChrome : undefined), args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Settings', exact: true }).click();
    const section = page.getByTestId('computer-access-settings');
    await section.scrollIntoViewIfNeeded();
    await expect(section.getByRole('tab', { name: 'Read and control', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(section).toContainText('Driver running');
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      for (const width of [768, 1000, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert(await section.evaluate((element) => element.scrollWidth <= element.clientWidth), `Overflow at ${width}`);
        await section.screenshot({ path: path.join(scratch, `settings-${theme}-${width}.png`) });
      }
    }
    await section.getByRole('tab', { name: 'Off', exact: true }).click();
    await expect(section.getByRole('tab', { name: 'Off', exact: true })).toHaveAttribute('aria-selected', 'true');
    await section.getByRole('tab', { name: 'Read windows', exact: true }).click();
    const confirm = section.getByRole('alertdialog', { name: 'Confirm desktop access' });
    await expect(confirm).toContainText('read the window list');
    await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(section.getByRole('tab', { name: 'Off', exact: true })).toHaveAttribute('aria-selected', 'true');
    assert.deepEqual(errors, []);
    step('Settings shows the running driver, turns access off in one click, and asks before enabling it again');

    if (model) {
      await section.getByRole('tab', { name: 'Read and control', exact: true }).click();
      await section.getByRole('button', { name: 'Allow control', exact: true }).click();
      await expect(section).toContainText('Driver running');
      await page.evaluate((model) => {
        const saved = JSON.parse(localStorage.getItem('agent-hq.state'));
        const state = saved.state;
        const ref = `openai:cli:${model}`;
        state.agents = Object.fromEntries(Object.entries(state.agents).map(([id, agent]) => [id, { ...agent, model: ref, modelLocked: true }]));
        state.roleDefaults = Object.fromEntries(['manager', 'architect', 'frontend', 'backend', 'qa', 'intern'].map((role) => [role, ref]));
        Object.assign(state, { activeView: 'workspace', orchestratorMode: 'plan', teamStrategy: 'fixed', approvalMode: 'auto', forceSetup: true, modelScope: 'sovereign', modelScopeChosen: true, tierModels: { simple: ref, standard: ref, complex: ref }, tierModes: { simple: 'locked', standard: 'locked', complex: 'locked' }, verificationCommand: '', learningMode: 'off', activeMission: null, managerChatMessages: [], runHistory: [] });
        localStorage.setItem('agent-hq.state', JSON.stringify(saved));
      }, model);
      const requests = [];
      page.on('request', (request) => { if (request.url().endsWith('/api/chat')) requests.push(request.postDataJSON().model); });
      await page.reload();
      const composer = page.getByRole('textbox', { name: 'Message Sovereign', exact: true });
      if (!await composer.isVisible()) await page.keyboard.press('Control+l');
      await composer.fill('Use the desktop tools to find the window titled "Agent HQ fixture". Its counter currently reads count 1. Replace the entry text with model-verified, click Increment exactly once, then read the window again to confirm count 2 text model-verified. This is one desktop task: no project files, shell, code, or external apps. Do not repeat a click whose outcome is uncertain; read first.');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      let approved = false;
      const state = await until('the real model desktop run', async () => {
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('agent-hq.state')).state);
        if (!approved && await page.getByRole('button', { name: 'Approve & run', exact: true }).isVisible()) {
          await page.getByRole('button', { name: 'Approve & run', exact: true }).click();
          approved = true;
        }
        fs.writeFileSync(path.join(scratch, 'model-state.json'), JSON.stringify(saved, null, 2), { mode: 0o600 });
        return saved.runHistory?.length ? saved : false;
      }, 10 * 60_000);
      assert.equal(state.runHistory.at(-1).status, 'completed', state.activeMission?.error);
      assert(fixtureOut.includes('count 2 text model-verified'), `The real model did not achieve the fixture result: ${fixtureOut}`);
      assert.equal(fixtureOut.trim().split('\n').length, 2, 'The model clicked more than once');
      assert(state.activeMission.tasks.some((task) => task.computerActions > 0), 'No desktop actions were recorded by the engine');
      assert(requests.length > 0 && requests.every((ref) => ref === `openai:cli:${model}`));
      fs.writeFileSync(path.join(scratch, 'model-check.json'), JSON.stringify({ model, requests, fixtureOut }, null, 2), { mode: 0o600 });
      step(`real ${model} UI-generated plan and worker loop typed, clicked once and read the result back`);
      await api('PUT', '/api/computer/access', { access: 'off' });
    }
  } finally {
    await browser.close();
  }

  status = (await api('GET', '/api/computer/status')).data;
  assert.equal(status.access, 'off');
  assert.equal(status.running, false);
  await until('the private socket folder to be removed', () => ownedDirs().every((name) => dirsBefore.has(name)), 5000);
  assert.equal(JSON.parse(fs.readFileSync(path.join(config, 'config.json'), 'utf8')).computerAccess, 'off');
  step('turning access off stops the driver, removes its socket folder and saves Off');
  console.log(`\nAll ${steps.length} checks passed. Screenshots: ${scratch}`);
} finally {
  for (const child of children.reverse()) child.kill('SIGTERM');
}
