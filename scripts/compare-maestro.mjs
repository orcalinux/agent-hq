import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { processMemory } from './process-memory.mjs';

const args = Object.fromEntries(process.argv.slice(2).filter((_, index) => index % 2 === 0).map((key, index) => [key.replace(/^--/, ''), process.argv[3 + index * 2]]));
for (const key of ['cli', 'profile', 'agent', 'workspace', 'output', 'pid', 'model']) if (!args[key]) throw new Error(`Missing --${key}. Use an existing signed-in Maestro research profile and a fresh task clone.`);
const workspace = fs.realpathSync(args.workspace);
const output = path.resolve(args.output);
if (fs.existsSync(output) && !args['observe-tab']) throw new Error('Use a new evidence directory.');
if (output === workspace || output.startsWith(workspace + path.sep)) throw new Error('Keep evidence outside the task clone.');
if (!args['observe-tab'] && execFileSync('git', ['status', '--porcelain'], { cwd: workspace, encoding: 'utf8' }).trim()) throw new Error('The task clone must be clean.');
if (!processMemory(Number(args.pid)).processes.length) throw new Error('The supplied app process is no longer readable. Resolve its current PID before dispatch.');
const task = fs.readFileSync(path.join(workspace, 'TASK.md'), 'utf8');
const cli = (values, json = true) => {
  const text = execFileSync(process.execPath, [args.cli, ...values], { env: { ...process.env, MAESTRO_USER_DATA: args.profile }, encoding: 'utf8', timeout: 30_000, maxBuffer: 24 * 1024 * 1024 });
  return json ? JSON.parse(text) : text;
};
const settings = cli(['show', 'agent', args.agent], false);
if (!settings.includes(`Model:               ${args.model}`) || !settings.includes('Effort:              medium') || !settings.includes(workspace)) {
  throw new Error('Check the agent directory, exact model and medium effort before dispatch.');
}
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const write = (file, value) => fs.writeFileSync(path.join(output, file), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const memory = args['observe-tab'] ? JSON.parse(fs.readFileSync(path.join(output, 'memory.json'), 'utf8')) : [{ phase: 'retained-session idle', ...processMemory(Number(args.pid)) }];
const metadata = args['observe-tab'] ? JSON.parse(fs.readFileSync(path.join(output, 'metadata.json'), 'utf8')) : {
  setup: 'Maestro desktop, one Codex agent', model: args.model, effort: 'medium',
  workspace, agentId: args.agent, settings, taskSha256: crypto.createHash('sha256').update(task).digest('hex'),
  initialTaskCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim(),
  startedAt: new Date().toISOString(), endedAt: null, wallMs: null, outcome: 'running',
  timing: 'dispatch to polled idle with native session id; at most 2 s polling delay',
};
if (args['observe-tab']) {
  metadata.observationResumedAt = new Date().toISOString();
  metadata.runnerInterruptions = [...(metadata.runnerInterruptions || []), { error: metadata.error, at: metadata.endedAt }];
  delete metadata.error;
  metadata.outcome = 'running';
  metadata.endedAt = null;
}
write('metadata.json', metadata);
const sample = () => { memory.push({ phase: 'run', ...processMemory(Number(args.pid)) }); write('memory.json', memory); };
const timer = setInterval(sample, 2000);
try {
  const dispatch = args['observe-tab'] ? { success: true, tabId: args['observe-tab'] } : cli(['dispatch', args.agent, task, '--new-tab', '--background']);
  if (!args['observe-tab']) write('dispatch.json', dispatch);
  if (!dispatch.success || !dispatch.tabId) throw new Error('Maestro did not acknowledge a new tab.');
  metadata.tabId = dispatch.tabId;
  const deadline = Date.now() + Number(args.minutes || 45) * 60_000;
  const appearedBy = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const state = cli(['session', 'list', '--json']);
    write('sessions.json', state);
    const tab = state.sessions.find((session) => session.tabId === dispatch.tabId);
    if (!tab) {
      if (Date.now() > appearedBy) throw new Error('The dispatched tab disappeared.');
      await delay(500);
      continue;
    }
    if (tab.agentSessionId && tab.state === 'idle') {
      metadata.outcome = 'idle-reported';
      metadata.nativeSessionId = tab.agentSessionId;
      write('transcript.json', cli(['session', 'show', dispatch.tabId, '--json']));
      break;
    }
    await delay(2000);
  }
  if (metadata.outcome === 'running') metadata.outcome = 'timeout';
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
  console.log(`${metadata.setup}: ${metadata.outcome}, ${(metadata.wallMs / 1000).toFixed(1)} s. Independently grade the files.`);
}
