import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { processMemory } from './process-memory.mjs';

const args = Object.fromEntries(process.argv.slice(2).filter((_, index) => index % 2 === 0).map((key, index) => [key.replace(/^--/, ''), process.argv[3 + index * 2]]));
for (const key of ['cli', 'project', 'workspace', 'output', 'pid', 'model']) if (!args[key]) throw new Error(`Missing --${key}. Register a fresh task clone in the existing research app first.`);
const workspace = fs.realpathSync(args.workspace);
const output = path.resolve(args.output);
if (fs.existsSync(output) && !args['observe-session']) throw new Error('Use a new evidence directory.');
if (output === workspace || output.startsWith(workspace + path.sep)) throw new Error('Keep evidence outside the task clone.');
if (!args['observe-session'] && execFileSync('git', ['status', '--porcelain'], { cwd: workspace, encoding: 'utf8' }).trim()) throw new Error('The task clone must be clean.');
const idle = processMemory(Number(args.pid));
if (!idle.processes.length) throw new Error('The supplied app process is no longer readable. Resolve its current PID before dispatch.');
const task = fs.readFileSync(path.join(workspace, 'TASK.md'), 'utf8');
const cli = (values, json = true) => {
  const text = execFileSync(args.cli, values, { encoding: 'utf8', timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });
  return json ? JSON.parse(text) : text;
};
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const write = (file, value) => fs.writeFileSync(path.join(output, file), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const memory = args['observe-session'] ? JSON.parse(fs.readFileSync(path.join(output, 'memory.json'), 'utf8')) : [{ phase: 'retained-session idle', ...idle }];
const metadata = args['observe-session'] ? JSON.parse(fs.readFileSync(path.join(output, 'metadata.json'), 'utf8')) : {
  setup: 'Agent Orchestrator desktop, one Codex worker', model: args.model, effort: 'medium',
  registeredWorkspace: workspace, project: args.project,
  taskSha256: crypto.createHash('sha256').update(task).digest('hex'),
  initialTaskCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim(),
  startedAt: new Date().toISOString(), endedAt: null, wallMs: null, outcome: 'running',
  timing: 'spawn to polled completed turn; at most 2 s polling delay plus CLI response time',
};
if (args['observe-session']) {
  metadata.observationResumedAt = new Date().toISOString();
  metadata.observationGaps = [...(metadata.observationGaps || []), { reason: 'Observer restarted with the current app PID; earlier unavailable samples remain in memory.json.', lastSample: memory.at(-1)?.at, resumedAt: metadata.observationResumedAt }];
  metadata.outcome = 'running';
  metadata.endedAt = null;
}
write('metadata.json', metadata);
const timer = setInterval(() => {
  memory.push({ phase: 'run', ...processMemory(Number(args.pid)) });
  write('memory.json', memory);
}, 2000);
try {
  const spawned = args['observe-session'] ? '' : cli(['spawn', '--project', args.project, '--name', 'Tier 2 Codex exact-model comparison', '--harness', 'codex', '--model', args.model, '--effort', 'medium', '--mode', 'chat', '--prompt', task], false);
  if (!args['observe-session']) write('spawn.json', { stdout: spawned });
  const id = args['observe-session'] || /spawned session (\S+)/.exec(spawned)?.[1];
  if (!id) throw new Error('Orchestrator did not return a session id.');
  metadata.sessionId = id;
  const deadline = Date.now() + Number(args.minutes || 45) * 60_000;
  while (Date.now() < deadline) {
    const state = cli(['session', 'get', id, '--json', '--transcript', '1', '--cap', '80']);
    metadata.branch = state.session?.branch;
    write('state.json', state);
    const turns = state.transcript?.turns || [];
    const terminal = turns.find((turn) => turn.completedAt && !['running', 'queued', 'starting'].includes(turn.state));
    if (terminal) {
      metadata.outcome = terminal.state;
      metadata.providerTurn = terminal;
      write('transcript.json', cli(['session', 'get', id, '--json', '--transcript', '500', '--cap', '0']));
      break;
    }
    if (state.session?.isTerminated || state.session?.status === 'error') throw new Error(`Orchestrator session stopped: ${state.session.status}`);
    await delay(2000);
  }
  if (metadata.outcome === 'running') metadata.outcome = 'timeout';
  const trees = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: workspace, encoding: 'utf8' });
  const block = trees.split('\n\n').find((entry) => metadata.branch && entry.split('\n').includes(`branch refs/heads/${metadata.branch}`));
  metadata.workspace = block?.split('\n').find((line) => line.startsWith('worktree '))?.slice(9) || null;
  if (!metadata.workspace) metadata.workspaceDiscovery = 'Not found in registered Git worktrees; inspect the native session before grading.';
} catch (error) {
  metadata.outcome = 'runner-error';
  metadata.error = error.stack || String(error);
  process.exitCode = 1;
} finally {
  clearInterval(timer);
  metadata.endedAt = new Date().toISOString();
  metadata.wallMs = Date.parse(metadata.endedAt) - Date.parse(metadata.startedAt);
  write('metadata.json', metadata);
  write('memory.json', memory);
  console.log(`${metadata.setup}: ${metadata.outcome}, ${(metadata.wallMs / 1000).toFixed(1)} s. Grade the actual worker workspace independently.`);
}
