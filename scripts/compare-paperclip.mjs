import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
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
const node24 = args.node24 || process.env.NODE24 || path.join(home, '.config/nvm/versions/node/v24.22.3/bin/node');
const node24Bin = path.dirname(node24);
const paperclipRepo = args.repo || path.join(home, '.local/share/agent-hq-research/paperclip');
const pytestBin = path.join(home, '.local/share/agent-hq-research/pytest-venv/bin');
const workspace = fs.realpathSync(args.workspace);
const output = path.resolve(args.output);
const effort = args.effort || 'medium';
const timeoutMs = Number(args.timeoutMs || 1_200_000);

if (fs.existsSync(output)) throw new Error('Use a new evidence directory.');
if (output === workspace || output.startsWith(workspace + path.sep)) {
  throw new Error('Keep evidence outside the task clone.');
}
if (execFileSync('git', ['status', '--porcelain'], { cwd: workspace, encoding: 'utf8' }).trim()) {
  throw new Error('The task clone must be clean.');
}

const task = fs.readFileSync(path.join(workspace, 'TASK.md'), 'utf8');
const paperclipHome = path.join(output, 'paperclip-home');
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
fs.mkdirSync(paperclipHome, { recursive: true, mode: 0o700 });

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

async function apiJson(baseUrl, method, route, body) {
  const res = await fetch(`${baseUrl}${route}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
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
    throw new Error(`${method} ${route} -> HTTP ${res.status}: ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`);
  }
  return parsed;
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopPaperclip(child, homeDir) {
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
    const deadline = Date.now() + 10_000;
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

const port = await findFreePort();
const baseUrl = `http://127.0.0.1:${port}`;
const serverLogPath = path.join(output, 'server.log');
const logFd = fs.openSync(serverLogPath, 'a', 0o600);

const childEnv = { ...process.env };
delete childEnv.OPENAI_API_KEY;
delete childEnv.DATABASE_URL;
delete childEnv.DATABASE_MIGRATION_URL;
childEnv.PATH = `${node24Bin}:${pytestBin}:${process.env.PATH || ''}`;
childEnv.COREPACK_ENABLE_DOWNLOAD_PROMPT = '0';
childEnv.PAPERCLIP_HOME = paperclipHome;
childEnv.PAPERCLIP_INSTANCE_ID = 'default';
childEnv.PAPERCLIP_OPEN_ON_LISTEN = 'false';
childEnv.PAPERCLIP_NO_BROWSER = 'true';
childEnv.PAPERCLIP_DISABLE_CWD_ENV_FILE = 'true';
childEnv.PAPERCLIP_DEPLOYMENT_MODE = 'local_trusted';
childEnv.PAPERCLIP_DEPLOYMENT_EXPOSURE = 'private';
childEnv.PAPERCLIP_BIND = 'loopback';
childEnv.HOST = '127.0.0.1';
childEnv.PORT = String(port);
childEnv.SERVE_UI = 'false';
childEnv.PAPERCLIP_UI_DEV_MIDDLEWARE = 'false';

const metadata = {
  setup: 'Paperclip headless server, codex_local adapter',
  model: args.model,
  effort,
  workspace,
  paperclipRepo,
  port,
  taskSha256: crypto.createHash('sha256').update(task).digest('hex'),
  initialTaskCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim(),
  startedAt: new Date().toISOString(),
  wallMs: 0,
  timedOut: false,
  error: null,
};

const memory = [];
const child = spawn(
  node24,
  ['cli/node_modules/tsx/dist/cli.mjs', 'cli/src/index.ts', 'onboard', '--yes', '--no-install-service', '--run', '-d', paperclipHome],
  {
    cwd: paperclipRepo,
    env: childEnv,
    detached: true,
    stdio: ['ignore', logFd, logFd],
  }
);
fs.closeSync(logFd);

let companyId = null;
let rootIssueId = null;
let runsSnapshot = [];
let issuesSnapshot = [];

try {
  // Wait for health endpoint up to 120s
  const bootDeadline = Date.now() + 120_000;
  let healthy = false;
  while (Date.now() < bootDeadline) {
    if (child.exitCode !== null) {
      throw new Error(`Paperclip exited early with code ${child.exitCode}. Check ${serverLogPath}`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.status === 200) {
        healthy = true;
        break;
      }
    } catch {
      // not listening yet
    }
    await delay(500);
  }
  if (!healthy) {
    throw new Error(`Paperclip /api/health timed out after 120s on port ${port}`);
  }

  const company = await apiJson(baseUrl, 'POST', '/api/companies', { name: 'Bench Company' });
  companyId = company.id;
  await apiJson(baseUrl, 'PATCH', `/api/companies/${companyId}`, { requireBoardApprovalForNewAgents: false });

  const project = await apiJson(baseUrl, 'POST', `/api/companies/${companyId}/projects`, {
    name: 'Workspace',
    status: 'in_progress',
    executionWorkspacePolicy: { enabled: true, defaultMode: 'shared_workspace' },
    workspace: { name: 'primary', sourceType: 'local_path', cwd: workspace, isPrimary: true },
  });
  let projectWorkspaceId = project.primaryWorkspace?.id ?? project.workspaces?.[0]?.id ?? null;
  if (!projectWorkspaceId) {
    const wsList = await apiJson(baseUrl, 'GET', `/api/projects/${project.id}/workspaces`);
    projectWorkspaceId = wsList?.[0]?.id ?? null;
  }

  const ceo = await apiJson(baseUrl, 'POST', `/api/companies/${companyId}/agents`, {
    name: 'CEO',
    role: 'ceo',
    adapterType: 'codex_local',
    runner: 'legacy',
    adapterConfig: {
      cwd: workspace,
      model: args.model,
      modelReasoningEffort: effort,
      dangerouslyBypassApprovalsAndSandbox: true,
      timeoutSec: 1200,
    },
  });

  const runStart = Date.now();
  const rootIssue = await apiJson(baseUrl, 'POST', `/api/companies/${companyId}/issues`, {
    projectId: project.id,
    ...(projectWorkspaceId ? { projectWorkspaceId } : {}),
    title: 'Implement tabsplit 3.0 specification and issues #21-#26',
    description: task,
    assigneeAgentId: ceo.id,
    status: 'todo',
    executionWorkspaceSettings: { mode: 'shared_workspace' },
  });
  rootIssueId = rootIssue.id;

  const activeStatuses = new Set(['queued', 'scheduled_retry', 'running']);
  let idlePolls = 0;
  let wokenOnce = false;
  let sawAnyRun = false;

  while (Date.now() - runStart < timeoutMs) {
    if (child.pid) {
      const mem = processMemory(child.pid);
      memory.push({ tMs: Date.now() - runStart, ...mem });
    }
    runsSnapshot = await apiJson(baseUrl, 'GET', `/api/companies/${companyId}/heartbeat-runs?limit=50`);
    issuesSnapshot = await apiJson(baseUrl, 'GET', `/api/companies/${companyId}/issues`);
    if (Array.isArray(runsSnapshot) && runsSnapshot.length > 0) {
      sawAnyRun = true;
    }

    const activeRuns = Array.isArray(runsSnapshot)
      ? runsSnapshot.filter((r) => activeStatuses.has(r.status))
      : [];
    const currentRoot = Array.isArray(issuesSnapshot)
      ? issuesSnapshot.find((i) => i.id === rootIssueId) ?? null
      : null;

    if (sawAnyRun && activeRuns.length === 0) {
      if (currentRoot && (currentRoot.status === 'done' || currentRoot.status === 'cancelled')) {
        break;
      }
      idlePolls += 1;
      if (idlePolls >= 6) {
        const pendingIssue = Array.isArray(issuesSnapshot)
          ? issuesSnapshot.find((i) => (i.status === 'todo' || i.status === 'in_progress') && i.assigneeAgentId)
          : null;
        if (!wokenOnce && pendingIssue) {
          wokenOnce = true;
          idlePolls = 0;
          await apiJson(baseUrl, 'POST', `/api/agents/${pendingIssue.assigneeAgentId}/wakeup`, {
            source: 'on_demand',
            reason: 'benchmark_poll',
          }).catch(() => {});
        } else {
          break;
        }
      }
    } else {
      idlePolls = 0;
    }
    await delay(2000);
  }

  metadata.wallMs = Date.now() - runStart;
  metadata.timedOut = metadata.wallMs >= timeoutMs;
  metadata.companyId = companyId;
  metadata.projectId = project.id;
  metadata.projectWorkspaceId = projectWorkspaceId;
  metadata.ceoAgentId = ceo.id;
  metadata.rootIssueId = rootIssueId;
  metadata.finishedAt = new Date().toISOString();
} catch (error) {
  metadata.error = error instanceof Error ? error.stack || error.message : String(error);
  metadata.finishedAt = new Date().toISOString();
  throw error;
} finally {
  write('metadata.json', metadata);
  write('runs.json', runsSnapshot);
  write('issues.json', issuesSnapshot);
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
  await stopPaperclip(child, paperclipHome);
}

console.log(JSON.stringify({ ok: !metadata.error, wallMs: metadata.wallMs, runs: runsSnapshot.length, issues: issuesSnapshot.length }, null, 2));
