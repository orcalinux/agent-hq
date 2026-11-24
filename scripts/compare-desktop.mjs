import fs from 'node:fs';
import crypto from 'node:crypto';
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
          openai:cli:gpt-6-sol
  --attach SPEC.md,ISSUES.md
  --strategy adaptive|fixed
  --timeout-minutes 30
  --verify "python -m pytest -q"   Verification command Agent HQ runs on the proposed changes (default: none).
  --wait-quota          Wait for the selected provider's local Magpie quota to show headroom.
  --resume-from DIR     Copy a stopped attempt's profile into NEW_EVIDENCE_DIR and resume its unfinished run.
  --stop-after-tasks N  Use the ordinary Stop action after N finished tasks; retain the attempt for a recovery test.
  --unlimited          Disable token, cost and per-agent call caps; keep the runner's wall-time limit.
  --run                Actually submit the task; otherwise only prepare the UI.
Uses TASK.md from the clone, a separate desktop profile, and your existing CLI login.
Evidence includes local paths and prompts; review before sharing.`);
  process.exit(args.help ? 0 : 1);
}

const workspace = fs.realpathSync(String(args.workspace));
const output = path.resolve(String(args.output));
const resumeFrom = typeof args['resume-from'] === 'string' ? fs.realpathSync(args['resume-from']) : null;
const previous = resumeFrom ? JSON.parse(fs.readFileSync(path.join(resumeFrom, 'metadata.json'), 'utf8')) : null;
const priorState = resumeFrom ? JSON.parse(fs.readFileSync(path.join(resumeFrom, 'state.json'), 'utf8')) : null;
const model = String(args.model || previous?.model || 'anthropic:cli:claude-haiku-5-5');
const verify = typeof args.verify === 'string' ? args.verify : previous?.verificationCommand ?? '';
const attachments = args.attach ? String(args.attach).split(',').filter(Boolean) : previous?.attachments ?? ['SPEC.md', 'ISSUES.md'];
const strategy = String(args.strategy || previous?.strategy || 'adaptive');
const timeoutMinutes = Number(args['timeout-minutes'] || 30);
const stopAfterTasks = args['stop-after-tasks'] === undefined ? null : Number(args['stop-after-tasks']);
const providerId = model.startsWith('anthropic:cli:') ? 'anthropic' : model.startsWith('openai:cli:') ? 'openai' : null;
if (!providerId) throw new Error('Choose an exact anthropic:cli: or openai:cli: model.');
if (model.endsWith(':default') || /:cli:(?:group\/|sonnet$|haiku$|opus$)/.test(model)) throw new Error('Benchmarks require a pinned model, not an alias or routing group.');
const quotaProvider = providerId === 'openai' ? 'codex' : 'claude';
if (!['adaptive', 'fixed'].includes(strategy)) throw new Error('Unknown team strategy.');
if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) throw new Error('Invalid timeout.');
if (stopAfterTasks !== null && (!Number.isSafeInteger(stopAfterTasks) || stopAfterTasks < 1)) throw new Error('Invalid completed-task checkpoint.');
if (fs.existsSync(output)) throw new Error('Use a new evidence directory to preserve previous results.');
if (output === workspace || output.startsWith(workspace + path.sep)) throw new Error('Keep evidence outside the task workspace.');
for (const attachment of attachments) {
  const target = fs.realpathSync(path.resolve(workspace, attachment));
  if (!target.startsWith(workspace + path.sep) || !fs.statSync(target).isFile()) throw new Error(`Invalid attachment: ${attachment}`);
}
const task = fs.readFileSync(path.join(workspace, 'TASK.md'), 'utf8');
const initialTaskCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim();
if (!resumeFrom && execFileSync('git', ['status', '--porcelain'], { cwd: workspace, encoding: 'utf8' }).trim()) {
  throw new Error('The task clone must be clean before the run.');
}
if (resumeFrom) {
  if (fs.existsSync(path.join(resumeFrom, 'desktop-profile', 'SingletonLock'))) {
    throw new Error('Close the previous benchmark application before copying its profile.');
  }
  if (fs.realpathSync(previous.workspace) !== workspace || previous.initialTaskCommit !== initialTaskCommit || previous.task !== task) {
    throw new Error('Resume requires the original workspace, starter commit and unchanged TASK.md.');
  }
  if (previous.model !== model || previous.strategy !== strategy || previous.verificationCommand !== verify
    || JSON.stringify(previous.attachments) !== JSON.stringify(attachments)) {
    throw new Error('Keep the original model, strategy, attachments and verification command when resuming.');
  }
  if (priorState.activeMission?.source !== 'live' || !['paused', 'failed', 'cancelled', 'running'].includes(priorState.activeMission.status)) {
    throw new Error('The previous attempt has no unfinished live mission to resume.');
  }
}
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const config = path.join(output, 'config');
const profile = path.join(output, 'desktop-profile');
if (resumeFrom) {
  fs.cpSync(path.join(resumeFrom, 'config'), config, { recursive: true });
  fs.cpSync(path.join(resumeFrom, 'desktop-profile'), profile, {
    recursive: true, filter: (source) => !path.basename(source).startsWith('Singleton'),
  });
} else {
  fs.mkdirSync(config, { mode: 0o700 });
  fs.writeFileSync(path.join(config, 'config.json'), JSON.stringify({
    workspaceRoot: workspace,
    connections: { [providerId]: { providerId, method: 'cli', connectedAt: new Date().toISOString() } },
    memory: { embeddingModel: 'off' },
  }), { mode: 0o600 });
}
const write = (name, data) => fs.writeFileSync(path.join(output, name), JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
const log = (text) => console.log(`${new Date().toISOString()} ${text}`);
const metadata = {
  version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version,
  appCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  appDirty: !!execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
  serverBuildSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'dist-electron/server.cjs'))).digest('hex'),
  rendererBuildSha256: crypto.createHash('sha256').update(fs.readdirSync(path.join(root, 'dist/assets')).filter((file) => file.endsWith('.js')).sort().map((file) => `${file}\n${fs.readFileSync(path.join(root, 'dist/assets', file), 'utf8')}`).join('\n')).digest('hex'),
  workspace, initialTaskCommit, model, strategy, attachments, task,
  startedAt: null, endedAt: null, wallMs: null, outcome: 'preparing',
  approval: 'auto', maxParallel: 3, modelPinned: true,
  verificationCommand: verify, learning: 'every-run', errors: [],
  limits: previous?.limits ?? (args.unlimited ? { maxCostUSD: null, maxTokens: null, maxMinutes: timeoutMinutes, maxCallsPerAgent: null, maxCostPerAgentUSD: null } : 'application defaults'),
  ...(resumeFrom ? { resumedFrom: resumeFrom, resumedMissionId: priorState.activeMission.id, previousOutcome: previous.outcome } : {}),
  ...(stopAfterTasks !== null ? { stopAfterTasks } : {}),
};
write('metadata.json', metadata);

async function waitForQuota() {
  let announced = 0;
  for (;;) {
    const all = JSON.parse(execFileSync('magpie', ['quota', '--json'], { encoding: 'utf8', timeout: 15_000 }));
    const windows = all.filter((entry) => entry.provider === quotaProvider).flatMap((entry) => entry.windows ?? []).filter((entry) => !entry.text && entry.lane !== 'images');
    write('quota.json', { at: new Date().toISOString(), windows: windows.map(({ name, used, remaining, resetsAt }) => ({ name, used, remaining, resetsAt })) });
    if (!windows.length) throw new Error(`No ${quotaProvider} quota reading; refusing to assume a reset.`);
    if (windows.every((entry) => entry.remaining > 0 && (!entry.resetsAt || Date.parse(entry.resetsAt) > Date.now()))) return;
    if (Date.now() - announced > 55_000) {
      log(`Waiting for ${quotaProvider} quota headroom.`);
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
    AGENT_HQ_USER_DATA: profile,
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
  if (!resumeFrom) await page.evaluate(({ model, strategy, verify, limits }) => {
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
    if (limits !== 'application defaults') state.runLimits = limits;
    localStorage.setItem('agent-hq.state', JSON.stringify(saved));
  }, { model, strategy, verify, limits: metadata.limits });
  await page.reload();
  const connection = await page.evaluate(async () => (await fetch('/api/connections')).json());
  const offered = connection.providers.find((entry) => entry.id === providerId)?.models ?? [];
  if (!offered.some((entry) => entry.ref === model)) throw new Error(`Pinned model not offered: ${model}`);
  if (resumeFrom) {
    await page.waitForFunction((id) => JSON.parse(localStorage.getItem('agent-hq.state') || '{"state":{}}').state.activeMission?.id === id, priorState.activeMission.id);
    const state = await snapshot();
    if (state.activeMission?.id !== priorState.activeMission.id) throw new Error('Restored mission does not match the previous attempt.');
    if (state.approvalMode !== priorState.approvalMode || state.verificationCommand !== verify || state.teamStrategy !== strategy
      || state.forceSetup !== true || state.complexityRouting !== false
      || Object.values(state.roleDefaults).some((ref) => ref !== model)
      || Object.values(state.agents).some((agent) => agent.model !== model || !agent.modelLocked)) {
      throw new Error('The restored profile does not preserve the pinned benchmark settings.');
    }
    const completed = priorState.activeMission.tasks.filter((entry) => entry.status === 'completed');
    for (const task of completed) {
      const restored = state.activeMission.tasks.find((entry) => entry.id === task.id);
      if (restored?.status !== 'completed' || restored.output !== task.output) throw new Error(`Finished task was not preserved: ${task.id}`);
    }
    write('recovery-check.json', { missionId: state.activeMission.id, completedTasksPreserved: completed.map((entry) => entry.id) });
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Tasks', exact: true }).click();
  } else {
    const composer = page.getByRole('textbox', { name: 'Message Sovereign', exact: true });
    if (!await composer.isVisible()) await page.keyboard.press('Control+l');
    await composer.waitFor({ state: 'visible' });
    for (const file of attachments) {
      await page.getByRole('button', { name: 'Attach a project file', exact: true }).click();
      await page.getByRole('textbox', { name: 'Search files to attach', exact: true }).fill(file);
      await page.getByRole('button', { name: file, exact: true }).click();
    }
    await composer.fill(task);
  }
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
    const previousRecord = resumeFrom ? JSON.stringify((await snapshot()).runHistory.find((entry) => entry.id === priorState.activeMission.id)) : undefined;
    await page.getByRole('button', { name: resumeFrom ? 'Resume' : 'Send', exact: true }).click();
    const deadline = Date.now() + timeoutMinutes * 60_000;
    let approved = Boolean(resumeFrom);
    let checkpointStopped = false;
    let lastStatus = '';
    while (Date.now() < deadline) {
      const state = await snapshot();
      write('state.json', state);
      const history = state.runHistory ?? [];
      const result = history.find((entry) => entry.id === state.activeMission?.id);
      if (result && (!resumeFrom || JSON.stringify(result) !== previousRecord)) {
        const paused = result.status === 'paused' && state.activeMission?.providerLimit;
        metadata.outcome = paused ? 'provider-blocked' : result.status;
        if (paused) {
          metadata.providerLimit = state.activeMission.providerLimit;
          process.exitCode = 2;
        }
        break;
      }
      if (resumeFrom && !calls.length && state.activeMission?.providerLimit?.resetAt > Date.now()) {
        metadata.outcome = 'provider-blocked';
        metadata.providerLimit = state.activeMission.providerLimit;
        process.exitCode = 2;
        break;
      }
      if (approved && !checkpointStopped && stopAfterTasks !== null
        && state.activeMission?.tasks.filter((entry) => entry.status === 'completed').length >= stopAfterTasks) {
        write('stop-checkpoint.json', state);
        await page.getByRole('button', { name: 'Stop run', exact: true }).click();
        checkpointStopped = true;
        metadata.intentionalStop = true;
        log('Stopped through the application UI at the completed-task checkpoint.');
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
    const reportedModels = calls.flatMap((entry) => entry.events.flatMap((event) =>
      event.type === 'done' && event.servedModel ? [event.servedModel] : event.type === 'start' && event.model ? [event.model] : []));
    const matchesPinned = calls.every((entry) => entry.model === model) && reportedModels.every((served) => served === model);
    metadata.modelPinned = matchesPinned;
    write('model-check.json', {
      requested: [...new Set(calls.map((entry) => entry.model))],
      served: [...new Set(reportedModels)],
      reported: calls.flatMap((entry) => entry.events.filter((event) => event.type === 'done')),
      matchesPinned,
    });
    if (!matchesPinned) throw new Error('The run used models outside the benchmark pin. Evidence is retained; do not treat it as a same-model comparison.');
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
