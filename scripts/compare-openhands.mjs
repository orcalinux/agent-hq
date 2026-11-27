import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
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

const home = process.env.HOME || os.homedir();
const openHandsRepo = args.repo || path.join(home, '.local/share/agent-hq-research/OpenHands');
const node24Bin = args.node24Bin || process.env.NODE24_BIN || path.join(home, '.config/nvm/versions/node/v24.22.3/bin');
const pytestBin = path.join(home, '.local/share/agent-hq-research/pytest-venv/bin');
const localBin = path.join(home, '.local/bin');
const workspace = fs.realpathSync(args.workspace);
const output = path.resolve(args.output);
const effort = args.effort || 'medium';
const baseUrlLlm = args['base-url'] || 'http://127.0.0.1:3425/v1';
const timeoutMs = Number(args.timeoutMs || 1_200_000);

if (fs.existsSync(output)) throw new Error('Use a new evidence directory.');
if (output === workspace || output.startsWith(workspace + path.sep)) {
  throw new Error('Keep evidence outside the task clone.');
}
if (execFileSync('git', ['status', '--porcelain'], { cwd: workspace, encoding: 'utf8' }).trim()) {
  throw new Error('The task clone must be clean.');
}

const { buildAgentServerCommand, buildAgentServerEnv, buildSafeDevConfig } = await import(
  pathToFileURL(path.join(openHandsRepo, 'scripts/dev-safe.mjs')).href
);

const task = fs.readFileSync(path.join(workspace, 'TASK.md'), 'utf8');
const ohHome = path.join(output, 'oh-home');
const stateDir = path.join(ohHome, 'agent-canvas');
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });

const write = (file, value) =>
  fs.writeFileSync(path.join(output, file), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });

async function findFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error('No free port allocated'))));
    });
  });
}

function findExtraTmuxPids(tmuxTmpDir, alreadySeen) {
  const roots = [];
  let entries = [];
  try {
    entries = fs.readdirSync('/proc');
  } catch {
    return roots;
  }
  for (const name of entries) {
    if (!/^\d+$/.test(name)) continue;
    const pid = Number(name);
    if (alreadySeen.has(pid)) continue;
    try {
      const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      if (cmdline.includes(tmuxTmpDir)) {
        roots.push(pid);
        continue;
      }
      const comm = fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim();
      if (comm.startsWith('tmux')) {
        const environ = fs.readFileSync(`/proc/${pid}/environ`, 'utf8');
        if (environ.includes(tmuxTmpDir)) roots.push(pid);
      }
    } catch {
      // ignore vanished / unreadable procs
    }
  }
  return roots;
}

function sampleOpenHandsMemory(backendPid, tmuxTmpDir) {
  const byPid = new Map();
  if (backendPid) {
    const tree = processMemory(backendPid);
    for (const proc of tree.processes) byPid.set(proc.pid, proc);
  }
  const extraRoots = findExtraTmuxPids(tmuxTmpDir, new Set(byPid.keys()));
  for (const root of extraRoots) {
    const tree = processMemory(root);
    for (const proc of tree.processes) byPid.set(proc.pid, proc);
  }
  const processes = [...byPid.values()];
  return {
    at: new Date().toISOString(),
    rootPid: backendPid,
    processes,
    pssMiB: processes.reduce((sum, p) => sum + p.pssKiB, 0) / 1024,
    rssMiB: processes.reduce((sum, p) => sum + p.rssKiB, 0) / 1024,
  };
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopOpenHands(child, homeDir) {
  if (child?.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      try {
        process.kill(child.pid, 'SIGTERM');
      } catch {
        // already exited
      }
    }
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      if (!isPidAlive(child.pid)) break;
      await delay(250);
    }
    if (isPidAlive(child.pid)) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        try {
          process.kill(child.pid, 'SIGKILL');
        } catch {
          // ignore
        }
      }
    }
  }
  try {
    execFileSync('pkill', ['-9', '-f', homeDir], { stdio: 'ignore' });
  } catch {
    // no matching processes
  }
}

const backendPort = await findFreePort();
let vscodePort = await findFreePort();
if (vscodePort === backendPort) vscodePort = await findFreePort();

const customEnv = {
  ...process.env,
  PATH: `${node24Bin}:${pytestBin}:${localBin}:${process.env.PATH || ''}`,
  OH_CANVAS_SAFE_BACKEND_PORT: String(backendPort),
  OH_CANVAS_SAFE_VSCODE_PORT: String(vscodePort),
  OH_CANVAS_SAFE_STATE_DIR: stateDir,
  LOCAL_BACKEND_API_KEY: crypto.randomBytes(24).toString('hex'),
  OH_SECRET_KEY: crypto.randomBytes(24).toString('hex'),
  OH_SECRET_KEY_PATH: path.join(stateDir, 'secret-key.txt'),
  OH_SESSION_API_KEY_PATH: path.join(stateDir, 'api-key.txt'),
  VITE_ENABLE_BROWSER_TOOLS: 'false',
  OH_ENABLE_BROWSER: 'false',
  DO_NOT_TRACK: '1',
  OPENHANDS_DO_NOT_TRACK: '1',
};

const safeConfig = buildSafeDevConfig(openHandsRepo, customEnv);
for (const dir of [
  safeConfig.stateDir,
  safeConfig.tmuxTmpDir,
  safeConfig.conversationsPath,
  safeConfig.workspacesPath,
  safeConfig.bashEventsDir,
]) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

const agentServerCmd = buildAgentServerCommand(customEnv);
const backendEnv = {
  ...customEnv,
  ...buildAgentServerEnv(safeConfig, { env: customEnv }),
};

const serverLogPath = path.join(output, 'agent-server.log');
const logFd = fs.openSync(serverLogPath, 'a', 0o600);

const metadata = {
  setup: 'OpenHands agent-server headless, codex via Magpie /v1',
  model: args.model,
  effort,
  baseUrlLlm,
  workspace,
  openHandsRepo,
  agentServerSource: agentServerCmd.source,
  backendPort,
  vscodePort,
  taskSha256: crypto.createHash('sha256').update(task).digest('hex'),
  initialTaskCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim(),
  startedAt: new Date().toISOString(),
  wallMs: 0,
  timedOut: false,
  error: null,
};

const memory = [];
const child = spawn(
  agentServerCmd.command,
  [...agentServerCmd.args, '--host', '127.0.0.1', '--port', String(backendPort)],
  {
    cwd: openHandsRepo,
    env: backendEnv,
    detached: true,
    stdio: ['ignore', logFd, logFd],
  }
);
fs.closeSync(logFd);

const apiBase = `http://127.0.0.1:${backendPort}`;
const authHeaders = {
  'Content-Type': 'application/json',
  'X-Session-API-Key': safeConfig.sessionApiKey,
};

let conversationId = crypto.randomUUID();
let conversationSnapshot = null;
let eventsSnapshot = null;

async function apiJson(method, route, body) {
  const res = await fetch(`${apiBase}${route}`, {
    method,
    headers: authHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const err = new Error(`${method} ${route} -> HTTP ${res.status}: ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`);
    err.status = res.status;
    err.body = parsed;
    throw err;
  }
  return parsed;
}

try {
  // Wait for agent-server health before starting timer
  const bootDeadline = Date.now() + 240_000;
  let healthy = false;
  while (Date.now() < bootDeadline) {
    if (child.exitCode !== null) {
      throw new Error(`OpenHands agent-server exited early with code ${child.exitCode}. Check ${serverLogPath}`);
    }
    for (const probe of ['/health', '/alive', '/server_info']) {
      try {
        const res = await fetch(`${apiBase}${probe}`, { headers: { 'X-Session-API-Key': safeConfig.sessionApiKey } });
        if (res.status === 200) {
          healthy = true;
          break;
        }
      } catch {
        // not ready yet
      }
    }
    if (healthy) break;
    await delay(500);
  }
  if (!healthy) {
    throw new Error(`OpenHands agent-server timed out after 240s on port ${backendPort}`);
  }

  const makePayload = (includeReasoningEffort) => ({
    conversation_id: conversationId,
    workspace: { kind: 'LocalWorkspace', working_dir: workspace },
    worktree: false,
    max_iterations: 200,
    stuck_detection: true,
    autotitle: false,
    confirmation_policy: { kind: 'NeverConfirm' },
    agent_settings: {
      agent_kind: 'openhands',
      llm: {
        model: args.model,
        base_url: baseUrlLlm,
        api_key: 'local',
        ...(includeReasoningEffort ? { reasoning_effort: effort } : {}),
        max_output_tokens: 16384,
      },
      condenser: { enabled: false },
      verification: { critic_enabled: false, enable_iterative_refinement: false },
      tools: [
        { name: 'terminal' },
        { name: 'file_editor' },
        { name: 'task_tracker' },
      ],
    },
    initial_message: {
      role: 'user',
      content: [{ type: 'text', text: task }],
    },
  });

  const runStart = Date.now();
  try {
    conversationSnapshot = await apiJson('POST', '/api/conversations', makePayload(true));
  } catch (err) {
    if (err.status === 422 && JSON.stringify(err.body || '').includes('reasoning_effort')) {
      conversationId = crypto.randomUUID();
      conversationSnapshot = await apiJson('POST', '/api/conversations', makePayload(false));
    } else {
      throw err;
    }
  }
  conversationId = conversationSnapshot?.id || conversationId;

  // If still idle 3s after creation, kick /run explicitly
  await delay(3000);
  const initialCheck = await apiJson('GET', `/api/conversations/${encodeURIComponent(conversationId)}`);
  if (initialCheck?.execution_status === 'idle') {
    await apiJson('POST', `/api/conversations/${encodeURIComponent(conversationId)}/run`).catch(() => {});
  }

  const activeStatuses = new Set(['running', 'starting']);
  let donePolls = 0;

  while (Date.now() - runStart < timeoutMs) {
    if (child.pid) {
      const mem = sampleOpenHandsMemory(child.pid, safeConfig.tmuxTmpDir);
      memory.push({ tMs: Date.now() - runStart, ...mem });
    }
    conversationSnapshot = await apiJson('GET', `/api/conversations/${encodeURIComponent(conversationId)}`);
    const countResp = await apiJson('GET', `/api/conversations/${encodeURIComponent(conversationId)}/events/count`).catch(() => ({ count: 0 }));
    const eventsCount = typeof countResp === 'number' ? countResp : Number(countResp?.count ?? countResp?.total ?? 0);
    const execStatus = conversationSnapshot?.execution_status ?? null;

    if (eventsCount >= 2 && execStatus && !activeStatuses.has(execStatus)) {
      donePolls += 1;
      if (donePolls >= 3) break;
    } else {
      donePolls = 0;
    }
    await delay(2000);
  }

  metadata.wallMs = Date.now() - runStart;
  metadata.timedOut = metadata.wallMs >= timeoutMs;
  metadata.conversationId = conversationId;
  metadata.executionStatus = conversationSnapshot?.execution_status ?? null;
  metadata.metrics = conversationSnapshot?.metrics ?? null;
  metadata.finishedAt = new Date().toISOString();

  // Paginate events for evidence
  const items = [];
  let pageId = null;
  for (let i = 0; i < 20; i++) {
    const q = pageId ? `limit=100&page_id=${encodeURIComponent(pageId)}` : 'limit=100';
    const page = await apiJson('GET', `/api/conversations/${encodeURIComponent(conversationId)}/events/search?${q}`).catch(() => null);
    if (!page || !Array.isArray(page.items)) break;
    items.push(...page.items);
    if (!page.next_page_id) break;
    pageId = page.next_page_id;
  }
  eventsSnapshot = { count: items.length, items };
} catch (error) {
  metadata.error = error instanceof Error ? error.stack || error.message : String(error);
  metadata.finishedAt = new Date().toISOString();
  throw error;
} finally {
  write('metadata.json', metadata);
  write('conversation.json', conversationSnapshot);
  write('events.json', eventsSnapshot);
  const peakPssMiB = Number(memory.reduce((max, s) => Math.max(max, s.pssMiB || 0), 0).toFixed(2));
  const peakRssMiB = Number(memory.reduce((max, s) => Math.max(max, s.rssMiB || 0), 0).toFixed(2));
  write('memory.json', { peakPssMiB, peakRssMiB, samples: memory });
  fs.writeFileSync(
    path.join(output, 'git-status.txt'),
    execFileSync('git', ['status', '--short'], { cwd: workspace, encoding: 'utf8' }),
    { mode: 0o600 }
  );
  fs.writeFileSync(
    path.join(output, 'git-diff.stat'),
    execFileSync('git', ['diff', '--stat'], { cwd: workspace, encoding: 'utf8' }),
    { mode: 0o600 }
  );
  await stopOpenHands(child, ohHome);
}

console.log(JSON.stringify({
  ok: !metadata.error,
  wallMs: metadata.wallMs,
  executionStatus: metadata.executionStatus,
  events: eventsSnapshot?.count ?? 0,
  metrics: metadata.metrics,
}, null, 2));
