import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { processMemory } from './process-memory.mjs';

const args = Object.fromEntries(process.argv.slice(2).filter((_, index) => index % 2 === 0).map((key, index) => [key.replace(/^--/, ''), process.argv[3 + index * 2]]));
if (!args.workspace || !args.output || !args.model) throw new Error('Use --workspace FRESH_CLONE --output NEW_EVIDENCE --model EXACT_MODEL [--binary PATH] [--minutes 45].');
if (/^(group\/|default$)/.test(args.model)) throw new Error('Pin an exact model.');
const workspace = fs.realpathSync(args.workspace);
const output = path.resolve(args.output);
if (fs.existsSync(output)) throw new Error('Use a new evidence directory.');
if (output === workspace || output.startsWith(workspace + path.sep)) throw new Error('Keep evidence outside the task workspace.');
if (execFileSync('git', ['status', '--porcelain'], { cwd: workspace, encoding: 'utf8' }).trim()) throw new Error('The task clone must be clean.');
const binary = args.binary || 'codex';
const task = fs.readFileSync(path.join(workspace, 'TASK.md'), 'utf8');
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const write = (file, value) => fs.writeFileSync(path.join(output, file), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const metadata = {
  setup: 'Codex CLI alone', workspace, model: args.model, effort: 'medium',
  sandbox: 'workspace-write', networkAccess: true,
  binaryVersion: execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim(),
  taskSha256: crypto.createHash('sha256').update(task).digest('hex'),
  initialTaskCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim(),
  startedAt: new Date().toISOString(), endedAt: null, wallMs: null, outcome: 'running',
};
write('metadata.json', metadata);
const fd = fs.openSync(path.join(output, 'events.jsonl'), 'w', 0o600);
const err = fs.openSync(path.join(output, 'stderr.log'), 'w', 0o600);
const child = spawn(binary, ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'workspace-write', '-m', args.model, '-c', 'model_reasoning_effort="medium"', '-c', 'sandbox_workspace_write.network_access=true', '-'], { cwd: workspace, env: process.env, stdio: ['pipe', fd, err] });
fs.closeSync(fd);
fs.closeSync(err);
child.stdin.end(task);
const memory = [];
const sample = () => { memory.push(processMemory(child.pid)); write('memory.json', memory); };
sample();
const timer = setInterval(sample, 2000);
const deadline = setTimeout(() => {
  metadata.outcome = 'timeout';
  child.kill('SIGTERM');
  setTimeout(() => child.kill('SIGKILL'), 3000).unref();
}, Number(args.minutes || 45) * 60_000);
const code = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', resolve);
}).finally(() => { clearInterval(timer); clearTimeout(deadline); });
metadata.endedAt = new Date().toISOString();
metadata.wallMs = Date.parse(metadata.endedAt) - Date.parse(metadata.startedAt);
metadata.exitCode = code;
if (metadata.outcome !== 'timeout') metadata.outcome = code === 0 ? 'completed' : 'failed';
write('metadata.json', metadata);
console.log(`${metadata.setup}: ${metadata.outcome}, ${(metadata.wallMs / 1000).toFixed(1)} s. Grade the files independently.`);
