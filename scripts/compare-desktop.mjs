import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron } from '@playwright/test';
import { processMemory } from './process-memory.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).flatMap((value, index, all) =>
  value.startsWith('--') ? [[value.slice(2), all[index + 1]?.startsWith('--') ? true : all[index + 1] ?? true]] : []));

if (args.help || !args.workspace || !args.output) {
  console.log(`Real Agent HQ desktop comparison (no provider mocks).
Build first: npm run build && npm run build:electron
Usage: node scripts/compare-desktop.mjs --workspace FRESH_CLONE --output NEW_EVIDENCE_DIR
  --model anthropic:cli:claude-haiku-5-5
  --attach SPEC.md,ISSUES.md
  --strategy adaptive|fixed
  --timeout-minutes 30
  --verify "python -m pytest -q"   Verification command Agent HQ runs on the proposed changes (default: none).
  --wait-quota          Wait for the local Magpie Claude quota to show headroom.
  --run                Actually submit the task; otherwise only prepare the UI.
Uses TASK.md from the clone, a separate desktop profile, and your existing CLI login.
Evidence includes local paths and prompts; review before sharing.`);
  process.exit(args.help ? 0 : 1);
}

const workspace = fs.realpathSync(String(args.workspace));
const output = path.resolve(String(args.output));
const model = String(args.model || 'anthropic:cli:claude-haiku-5-5');
const verify = typeof args.verify === 'string' ? args.verify : '';
const attachments = String(args.attach || 'SPEC.md,ISSUES.md').split(',').filter(Boolean);
const strategy = String(args.strategy || 'adaptive');
const timeoutMinutes = Number(args['timeout-minutes'] || 30);
if (!model.startsWith('anthropic:cli:')) throw new Error('This comparison runner currently supports the Claude Code CLI connection only.');
if (!['adaptive', 'fixed'].includes(strategy)) throw new Error('Unknown team strategy.');
if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) throw new Error('Invalid timeout.');
if (fs.existsSync(output)) throw new Error('Use a new evidence directory to preserve previous results.');
if (output === workspace || output.startsWith(workspace + path.sep)) throw new Error('Keep evidence outside the task workspace.');
for (const attachment of attachments) {
  const target = fs.realpathSync(path.resolve(workspace, attachment));
  if (!target.startsWith(workspace + path.sep) || !fs.statSync(target).isFile()) throw new Error(`Invalid attachment: ${attachment}`);
}
const task = fs.readFileSync(path.join(workspace, 'TASK.md'), 'utf8');
const initialTaskCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim();
if (execFileSync('git', ['status', '--porcelain'], { cwd: workspace, encoding: 'utf8' }).trim()) {
  throw new Error('The task clone must be clean before the run.');
}
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const config = path.join(output, 'config');
fs.mkdirSync(config, { mode: 0o700 });
fs.writeFileSync(path.join(config, 'config.json'), JSON.stringify({
  workspaceRoot: workspace,
  connections: { anthropic: { providerId: 'anthropic', method: 'cli', connectedAt: new Date().toISOString() } },
  memory: { embeddingModel: 'off' },
}), { mode: 0o600 });
const write = (name, data) => fs.writeFileSync(path.join(output, name), JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
const log = (text) => console.log(`${new Date().toISOString()} ${text}`);
const metadata = {
  version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version,
  appCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  workspace, initialTaskCommit, model, strategy, attachments, task,
  startedAt: null, endedAt: null, wallMs: null, outcome: 'preparing',
  approval: 'auto', maxParallel: 3, modelPinned: true,
  verificationCommand: verify, learning: 'every-run', errors: [],
};
write('metadata.json', metadata);

async function waitForQuota() {
  let announced = 0;
  for (;;) {
    const all = JSON.parse(execFileSync('magpie', ['quota', '--json'], { encoding: 'utf8', timeout: 15_000 }));
    const windows = all.filter((entry) => entry.provider === 'claude').flatMap((entry) => entry.windows ?? []);
    write('quota.json', { at: new Date().toISOString(), windows: windows.map(({ name, used, remaining, resetsAt }) => ({ name, used, remaining, resetsAt })) });
    if (!windows.length) throw new Error('No Claude quota reading; refusing to assume a reset.');
    if (windows.every((entry) => entry.remaining > 0 && (!entry.resetsAt || Date.parse(entry.resetsAt) > Date.now()))) return;
    if (Date.now() - announced > 55_000) {
      log('Waiting for Claude quota headroom.');
      announced = Date.now();
    }
    await delay(30_000);
  }
}

const app = await _electron.launch({
  args: [root],
  cwd: root,
  env: {
    ...process.env,
    AGENT_HQ_WORKSPACE: workspace,
    AGENT_HQ_CONFIG_DIR: config,
    AGENT_HQ_USER_DATA: path.join(output, 'desktop-profile'),
    AGENT_HQ_NO_UPDATES: '1',
    AGENT_HQ_HIDDEN: '1',
  },
  timeout: 60_000,
});
const memory = [];
const calls = [];
const pendingResponses = new Set();
let page;
let sampleTimer;
let submitted = false;
const snapshot = async () => page.evaluate(() => JSON.parse(localStorage.getItem('agent-hq.state') || '{"state":{}}').state);
try {
  page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  page.on('pageerror', (error) => metadata.errors.push(error.message));
  page.on('response', (response) => {
    if (!response.url().endsWith('/api/chat')) return;
    const request = response.request();
    const body = request.postDataJSON();
    const entry = {
      model: body.model, system: body.system, messages: body.messages,
      at: new Date().toISOString(), startedAt: request.timing().startTime,
      status: response.status(), events: [], finishedAt: null,
    };
    calls.push(entry);
    const pending = (async () => {
      try {
        const text = await response.text();
        entry.events = text.split('\n').filter((line) => line.startsWith('data: ')).map((line) => JSON.parse(line.slice(6)));
      } catch (error) {
        entry.error = error.message;
      }
      entry.finishedAt = Date.now();
      write('calls.json', calls);
    })();
    pendingResponses.add(pending);
    void pending.finally(() => pendingResponses.delete(pending));
  });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => localStorage.getItem('agent-hq.state'));
  await page.evaluate(({ model, strategy, verify }) => {
    const saved = JSON.parse(localStorage.getItem('agent-hq.state'));
    const state = saved.state;
    state.agents = Object.fromEntries(Object.entries(state.agents).map(([id, agent]) =>
      [id, { ...agent, model, modelLocked: true }]));
    state.roleDefaults = Object.fromEntries(['manager', 'architect', 'frontend', 'backend', 'qa', 'intern'].map((role) => [role, model]));
    Object.assign(state, {
      activeView: 'workspace', orchestratorMode: 'plan', teamStrategy: strategy, maxParallel: 3,
      approvalMode: 'auto', complexityRouting: false, forceSetup: true,
      tierModels: { simple: model, standard: model, complex: model },
      tierModes: { simple: 'locked', standard: 'locked', complex: 'locked' },
      modelScope: 'sovereign', modelScopeChosen: true, managerChatMessages: [],
      verificationCommand: verify, learningMode: 'every-run', activeMission: null, runHistory: [],
    });
    localStorage.setItem('agent-hq.state', JSON.stringify(saved));
  }, { model, strategy, verify });
  await page.reload();
  const connection = await page.evaluate(async () => (await fetch('/api/connections')).json());
  const offered = connection.providers.find((entry) => entry.id === 'anthropic')?.models ?? [];
  if (!offered.some((entry) => entry.ref === model)) throw new Error(`Pinned model not offered: ${model}`);
  const composer = page.getByRole('textbox', { name: 'Message Sovereign', exact: true });
  if (!await composer.isVisible()) await page.keyboard.press('Control+l');
  await composer.waitFor({ state: 'visible' });
  for (const file of attachments) {
    await page.getByRole('button', { name: 'Attach a project file', exact: true }).click();
    await page.getByRole('textbox', { name: 'Search files to attach', exact: true }).fill(file);
    await page.getByRole('button', { name: file, exact: true }).click();
  }
  await composer.fill(task);
  memory.push({ phase: 'idle', ...processMemory(app.process().pid) });
  write('memory.json', memory);
  await page.screenshot({ path: path.join(output, 'prepared.png') });
  write('prepared-state.json', await snapshot());
  log(`Prepared Agent HQ ${metadata.version}, pinned ${model}, ${attachments.length} attachments.`);
  if (args.run) {
    if (args['wait-quota']) await waitForQuota();
    metadata.startedAt = new Date().toISOString();
    metadata.outcome = 'running';
    write('metadata.json', metadata);
    sampleTimer = setInterval(() => {
      memory.push({ phase: 'run', ...processMemory(app.process().pid) });
      write('memory.json', memory);
    }, 2000);
    submitted = true;
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const deadline = Date.now() + timeoutMinutes * 60_000;
    let approved = false;
    let lastStatus = '';
    while (Date.now() < deadline) {
      const state = await snapshot();
      write('state.json', state);
      const history = state.runHistory ?? [];
      if (history.length) {
        metadata.outcome = history.at(-1).status;
        break;
      }
      if (!approved) {
        const approve = page.getByRole('button', { name: 'Approve & run', exact: true });
        if (await approve.isVisible()) {
          await page.screenshot({ path: path.join(output, 'plan.png') });
          write('plan-state.json', state);
          await approve.click();
          approved = true;
          log('Approved the model-generated plan.');
        } else if (pendingResponses.size === 0 && calls.length && calls.every((entry) => entry.finishedAt)) {
          const error = state.managerChatMessages?.find((entry) => entry.sender === 'manager' && (entry.planError || entry.error));
          if (error) throw new Error(error.planError || error.error);
        }
      }
      const status = `${approved ? 'execution' : 'planning'}: ${state.activeMission?.tasks?.filter((entry) => entry.status === 'completed').length ?? 0} tasks complete, ${calls.length} calls`;
      if (status !== lastStatus) {
        log(status);
        lastStatus = status;
      }
      await delay(2000);
    }
    if (metadata.outcome === 'running') throw new Error('Comparison timed out.');
    metadata.endedAt = new Date().toISOString();
    metadata.wallMs = Date.parse(metadata.endedAt) - Date.parse(metadata.startedAt);
    log(`${metadata.outcome}, ${Math.round(metadata.wallMs / 1000)} seconds.`);
    for (let attempt = 0; attempt < 30 && pendingResponses.size; attempt++) await delay(2000);
    await page.screenshot({ path: path.join(output, 'outcome.png') });
    write('state.json', await snapshot());
    write('calls.json', calls);
    write('model-check.json', {
      requested: [...new Set(calls.map((entry) => entry.model))],
      reported: calls.flatMap((entry) => entry.events.filter((event) => event.type === 'done')),
      matchesPinned: calls.every((entry) => entry.model === model),
    });
  } else {
    metadata.outcome = 'prepared-only';
    log('No task submitted. Add --run to consume real subscription usage.');
  }
} catch (error) {
  metadata.errors.push(error.stack ?? String(error));
  metadata.outcome = 'runner-error';
  if (submitted) metadata.endedAt = new Date().toISOString();
  if (metadata.startedAt && metadata.endedAt) metadata.wallMs = Date.parse(metadata.endedAt) - Date.parse(metadata.startedAt);
  if (page) {
    await page.screenshot({ path: path.join(output, 'error.png') }).catch(() => {});
    write('state.json', await snapshot().catch(() => ({})));
  }
  process.exitCode = 1;
  log(error.message);
} finally {
  clearInterval(sampleTimer);
  write('memory.json', memory);
  write('calls.json', calls);
  write('metadata.json', metadata);
  await app.close();
}
