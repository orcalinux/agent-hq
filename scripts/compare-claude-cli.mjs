import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { processMemory } from './process-memory.mjs';

const args = Object.fromEntries(process.argv.slice(2).filter((_, index) => index % 2 === 0).map((key, index) => [key.replace(/^--/, ''), process.argv[3 + index * 2]]));
if (!args.workspace || !args.output || !args.model) throw new Error('Use --workspace FRESH_CLONE --output NEW_EVIDENCE --model EXACT_MODEL [--binary PATH] [--minutes 45].');
if (!/^claude-/.test(args.model) || /^(?:claude-(?:haiku|sonnet|opus)|.*latest)$/.test(args.model)) throw new Error('Pin an exact Claude model.');
const workspace = fs.realpathSync(args.workspace);
const output = path.resolve(args.output);
const minutes = Number(args.minutes || 45);
if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('Invalid timeout.');
if (fs.existsSync(output)) throw new Error('Use a new evidence directory.');
if (output === workspace || output.startsWith(workspace + path.sep)) throw new Error('Keep evidence outside the task workspace.');
if (execFileSync('git', ['status', '--porcelain'], { cwd: workspace, encoding: 'utf8' }).trim()) throw new Error('The task clone must be clean.');
const binary = args.binary || 'claude';
const task = fs.readFileSync(path.join(workspace, 'TASK.md'), 'utf8');
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const write = (file, value) => fs.writeFileSync(path.join(output, file), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const metadata = {
  setup: 'Claude Code alone', workspace, model: args.model, effort: 'medium',
  permissions: 'bypassPermissions', isolation: 'fresh task clone; CLI tools are not sandboxed',
  binaryVersion: execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim(),
  taskSha256: crypto.createHash('sha256').update(task).digest('hex'),
  initialTaskCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim(),
  startedAt: new Date().toISOString(), endedAt: null, wallMs: null, outcome: 'running',
};
write('metadata.json', metadata);
const stdout = fs.openSync(path.join(output, 'result.json'), 'w', 0o600);
const stderr = fs.openSync(path.join(output, 'stderr.log'), 'w', 0o600);
const child = spawn(binary, ['-p', '--output-format', 'json', '--model', args.model, '--effort', 'medium', '--permission-mode', 'bypassPermissions'], {
  cwd: workspace, env: process.env, stdio: ['pipe', stdout, stderr],
});
fs.closeSync(stdout);
fs.closeSync(stderr);
child.stdin.on('error', () => {});
child.stdin.end(task);
const memory = [];
const sample = () => { memory.push(processMemory(child.pid)); write('memory.json', memory); };
sample();
const timer = setInterval(sample, 2000);
const deadline = setTimeout(() => {
  metadata.outcome = 'timeout';
  child.kill('SIGTERM');
  setTimeout(() => child.kill('SIGKILL'), 3000).unref();
}, minutes * 60_000);
try {
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  metadata.exitCode = code;
  const result = JSON.parse(fs.readFileSync(path.join(output, 'result.json'), 'utf8'));
  if (metadata.outcome !== 'timeout') metadata.outcome = code === 0 && !result.is_error ? 'completed' : 'failed';
  metadata.reportedModels = Object.keys(result.modelUsage ?? {});
  metadata.apiRateValueUSD = result.total_cost_usd ?? null;
} catch (error) {
  metadata.error = error.stack || String(error);
  if (metadata.outcome !== 'timeout') metadata.outcome = 'runner-error';
} finally {
  clearInterval(timer);
  clearTimeout(deadline);
  metadata.endedAt = new Date().toISOString();
  metadata.wallMs = Date.parse(metadata.endedAt) - Date.parse(metadata.startedAt);
  write('metadata.json', metadata);
  write('memory.json', memory);
}
if (metadata.outcome !== 'completed') process.exitCode = 1;
console.log(`${metadata.setup}: ${metadata.outcome}, ${(metadata.wallMs / 1000).toFixed(1)} s. Grade the files independently.`);
