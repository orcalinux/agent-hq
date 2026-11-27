import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron as electron } from 'playwright';
import { processMemory } from './process-memory.mjs';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((_, index) => index % 2 === 0)
    .map((key, index) => [key.replace(/^--/, ''), process.argv[3 + index * 2]])
);

for (const key of ['workspace', 'output', 'model']) {
  if (!args[key]) {
    throw new Error(`Missing --${key}. Provide --workspace, --output, and --model.`);
  }
}

const home = process.env.HOME;
const exe =
  args.exe ||
  path.join(home, '.local/share/agent-hq-research/installed/agent-teams-ai/opt/Agent-Teams-AI/agent-teams-ai');
const claudeRoot =
  args['claude-root'] ||
  path.join(home, '.local/share/agent-hq-research/profiles/agent-teams-ai/claude');
const workspace = fs.realpathSync(args.workspace);
const output = path.resolve(args.output);
if (fs.existsSync(output)) throw new Error('Use a new evidence directory.');
if (output === workspace || output.startsWith(workspace + path.sep)) {
  throw new Error('Keep evidence outside the task clone.');
}
if (execFileSync('git', ['status', '--porcelain'], { cwd: workspace, encoding: 'utf8' }).trim()) {
  throw new Error('The task clone must be clean.');
}

const task = fs.readFileSync(path.join(workspace, 'TASK.md'), 'utf8');
const effort = args.effort || 'medium';
const teamName = args.team || `bench-t3-${Date.now()}`;
const userDataDir = path.join(output, 'profile-teams');
const chromiumDir = path.join(output, 'chromium');

fs.mkdirSync(userDataDir, { recursive: true, mode: 0o700 });
fs.mkdirSync(chromiumDir, { recursive: true, mode: 0o700 });
const write = (file, value) =>
  fs.writeFileSync(path.join(output, file), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });

const memory = [];
const metadata = {
  setup: 'Agent Teams AI desktop, Codex team',
  teamName,
  model: args.model,
  effort,
  providerId: 'codex',
  providerBackendId: 'codex-native',
  workspace,
  taskSha256: crypto.createHash('sha256').update(task).digest('hex'),
  initialTaskCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim(),
  startedAt: null,
  endedAt: null,
  wallMs: null,
  outcome: 'running',
  timing: 'create + launch HTTP call to settled lead idle/offline and runtime completion; 2s polling',
};

let electronApp = null;
let appPid = null;
let timer = null;
let port = null;

async function httpJson(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, ok: res.ok, body: json };
}

try {
  electronApp = await electron.launch({
    executablePath: exe,
    args: ['--no-sandbox', `--user-data-dir=${chromiumDir}`],
    env: {
      ...process.env,
      AGENT_TEAMS_ELECTRON_USER_DATA_DIR: userDataDir,
      AGENT_TEAMS_ELECTRON_CLAUDE_ROOT: claudeRoot,
    },
    timeout: 60_000,
  });
  appPid = electronApp.process()?.pid;
  if (!appPid) throw new Error('Failed to determine Agent Teams AI root PID.');
  metadata.appPid = appPid;

  const page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  const httpInfo = await page.evaluate(async () => {
    const start = await window.electronAPI.httpServer.start();
    const codexStatus = await window.electronAPI.codexRuntime.getStatus();
    return { start, codexStatus };
  });
  port = httpInfo.start?.port ?? httpInfo.start?.data?.port ?? 3456;
  metadata.port = port;
  metadata.codexStatus = httpInfo.codexStatus;
  metadata.startedAt = new Date().toISOString();
  write('metadata.json', metadata);

  memory.push({ phase: 'retained-session idle', ...processMemory(appPid) });
  write('memory.json', memory);

  timer = setInterval(() => {
    try {
      memory.push({ phase: 'run', ...processMemory(appPid) });
      write('memory.json', memory);
    } catch {
      // ignore if process exiting
    }
  }, 2000);

  const baseUrl = `http://127.0.0.1:${port}`;
  const createPayload = {
    teamName,
    projectContextMode: 'shared',
    runtimeSelectionVersion: 1,
    providerId: 'codex',
    providerBackendId: 'codex-native',
    model: args.model,
    effort,
    cwd: workspace,
    prompt: task,
    skipPermissions: true,
    members: [
      {
        name: 'builder',
        role: 'Software Engineer',
        providerId: 'codex',
        providerBackendId: 'codex-native',
        model: args.model,
        effort,
      },
    ],
  };

  const created = await httpJson(`${baseUrl}/api/teams`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(createPayload),
  });
  write('create.json', created);
  if (!created.ok) {
    throw new Error(`POST /api/teams failed (${created.status}): ${JSON.stringify(created.body)}`);
  }

  metadata.launchRequestedAt = new Date().toISOString();
  const launched = await httpJson(`${baseUrl}/api/teams/${encodeURIComponent(teamName)}/launch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cwd: workspace,
      providerId: 'codex',
      providerBackendId: 'codex-native',
      model: args.model,
      effort,
      prompt: task,
      skipPermissions: true,
      runtimeSelectionVersion: 1,
    }),
  });
  write('launch.json', launched);
  if (!launched.ok) {
    throw new Error(`POST /api/teams/${teamName}/launch failed (${launched.status}): ${JSON.stringify(launched.body)}`);
  }

  const runId = launched.body?.runId;
  metadata.runId = runId;
  write('metadata.json', metadata);

  const deadline = Date.now() + Number(args.minutes || 25) * 60_000;
  let sawReadyOrActive = false;
  let sawAlive = false;
  let settleCount = 0;
  let lastSummary = '';

  while (Date.now() < deadline) {
    const [provRes, runtimeRes, diagRes, teamRes, ipcState] = await Promise.all([
      runId ? httpJson(`${baseUrl}/api/teams/provisioning/${encodeURIComponent(runId)}`) : Promise.resolve(null),
      httpJson(`${baseUrl}/api/teams/${encodeURIComponent(teamName)}/runtime`),
      httpJson(`${baseUrl}/api/teams/${encodeURIComponent(teamName)}/members/diagnostics`),
      httpJson(`${baseUrl}/api/teams/${encodeURIComponent(teamName)}`),
      page
        .evaluate(async (name) => {
          const [lead, leadCtx, tasks, stats] = await Promise.all([
            window.electronAPI.teams.getLeadActivity(name).catch(() => null),
            window.electronAPI.teams.getLeadContext?.(name).catch(() => null),
            window.electronAPI.teams.getAllTasks(name).catch(() => null),
            window.electronAPI.teams.getMemberStats(name).catch(() => null),
          ]);
          return { lead, leadCtx, tasks, stats };
        }, teamName)
        .catch(() => null),
    ]);

    if (provRes?.body) write('provisioning.json', provRes.body);
    if (runtimeRes?.body) write('runtime.json', runtimeRes.body);
    if (diagRes?.body) write('diagnostics.json', diagRes.body);
    if (teamRes?.body) write('team.json', teamRes.body);
    if (ipcState) write('ipc-state.json', ipcState);

    const provState = provRes?.body?.state;
    if (provState === 'failed' || provState === 'cancelled') {
      metadata.outcome = `provisioning-${provState}`;
      metadata.error = provRes.body.error || provRes.body.message || JSON.stringify(provRes.body);
      break;
    }

    const isAlive = Boolean(runtimeRes?.body?.isAlive);
    const leadState = ipcState?.lead?.state;
    const members = diagRes?.body?.members || diagRes?.body || [];
    const memberList = Array.isArray(members) ? members : [];
    const anyMemberAlive = memberList.some((m) => m?.alive || m?.runtimeAlive);
    const anyMemberHardFailed = memberList.some((m) => m?.hardFailure);
    const tasks = Array.isArray(ipcState?.tasks) ? ipcState.tasks : [];
    const activeTasks = tasks.filter((t) => t?.status === 'in_progress' || t?.status === 'pending');

    const summary = `prov=${provState || '?'} isAlive=${isAlive} lead=${leadState || '?'} membersAlive=${memberList.filter((m) => m?.alive || m?.runtimeAlive).length}/${memberList.length} tasks=${tasks.length - activeTasks.length}/${tasks.length}`;
    if (summary !== lastSummary) {
      console.log(`${new Date().toISOString()} ${summary}`);
      lastSummary = summary;
    }

    if (isAlive || anyMemberAlive) sawAlive = true;
    if (provState === 'ready' || leadState === 'active' || sawAlive) sawReadyOrActive = true;

    if (anyMemberHardFailed && !isAlive) {
      metadata.outcome = 'member-hard-failure';
      metadata.diagnostics = memberList;
      break;
    }

    const elapsedSinceLaunch = Date.now() - Date.parse(metadata.launchRequestedAt);
    const settledRuntime =
      (sawAlive && !isAlive && !anyMemberAlive) ||
      (sawReadyOrActive &&
        elapsedSinceLaunch > 20_000 &&
        (leadState === 'idle' || leadState === 'offline') &&
        !anyMemberAlive &&
        activeTasks.length === 0) ||
      (sawReadyOrActive &&
        elapsedSinceLaunch > 30_000 &&
        leadState === 'idle' &&
        tasks.length > 0 &&
        activeTasks.length === 0);

    if (settledRuntime) {
      settleCount += 1;
      if (settleCount >= 5) {
        metadata.outcome = isAlive ? 'idle-reported' : 'completed';
        break;
      }
    } else {
      settleCount = 0;
    }

    await delay(2000);
  }

  if (metadata.outcome === 'running') {
    metadata.outcome = 'timeout';
  }
} catch (error) {
  metadata.outcome = 'runner-error';
  metadata.error = error.stack || String(error);
  process.exitCode = 1;
} finally {
  if (timer) clearInterval(timer);
  if (port) {
    await httpJson(`http://127.0.0.1:${port}/api/teams/${encodeURIComponent(teamName)}/force-stop`, {
      method: 'POST',
    }).catch(() => {});
  }
  metadata.endedAt = new Date().toISOString();
  metadata.wallMs = metadata.startedAt ? Date.parse(metadata.endedAt) - Date.parse(metadata.startedAt) : 0;
  write('metadata.json', metadata);
  write('memory.json', memory);
  if (electronApp) {
    await electronApp.close().catch(() => {});
  }
  console.log(`${metadata.setup}: ${metadata.outcome}, ${(metadata.wallMs / 1000).toFixed(1)} s.`);
}
