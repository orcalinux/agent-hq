import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
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
const pythonBin = args.python || '/tmp/metagpt-venv/bin/python';
const metagptDir = args['metagpt-dir'] || path.join(home, '.local/share/agent-hq-research/MetaGPT');
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
const isolatedHome = path.join(output, 'home');
const metagptCfgDir = path.join(isolatedHome, '.metagpt');
fs.mkdirSync(metagptCfgDir, { recursive: true, mode: 0o700 });
fs.writeFileSync(
  path.join(metagptCfgDir, 'config2.yaml'),
  [
    'llm:',
    '  api_type: "openai"',
    '  base_url: "http://127.0.0.1:3425/v1"',
    '  api_key: "local"',
    `  model: "${args.model}"`,
    '',
  ].join('\n'),
  { mode: 0o600 }
);

const write = (file, value) =>
  fs.writeFileSync(path.join(output, file), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });

const investment = args.investment || '2.0';
const nRound = args['n-round'] || '5';
const memory = [];
const metadata = {
  setup: 'MetaGPT CLI (software_company --inc), Magpie OpenAI-compatible proxy',
  model: args.model,
  investment: Number(investment),
  nRound: Number(nRound),
  workspace,
  taskSha256: crypto.createHash('sha256').update(task).digest('hex'),
  initialTaskCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim(),
  startedAt: new Date().toISOString(),
  endedAt: null,
  wallMs: null,
  outcome: 'running',
  exitCode: null,
  timing: 'process spawn to exit; 2s memory polling',
};
write('metadata.json', metadata);

const stdoutStream = fs.createWriteStream(path.join(output, 'stdout.log'), { mode: 0o600 });
const stderrStream = fs.createWriteStream(path.join(output, 'stderr.log'), { mode: 0o600 });

const childArgs = [
  '-c',
  'import pandas, sys, runpy; sys.argv = ["metagpt.software_company"] + sys.argv[1:]; runpy.run_module("metagpt.software_company", run_name="__main__")',
  task,
  '--project-path',
  workspace,
  '--inc',
  '--investment',
  investment,
  '--n-round',
  nRound,
  '--code-review',
  '--implement',
];

const child = spawn(pythonBin, childArgs, {
  cwd: workspace,
  env: {
    ...process.env,
    HOME: isolatedHome,
    PYTHONPATH: metagptDir,
    PYTHONUNBUFFERED: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

child.stdout.pipe(stdoutStream);
child.stderr.pipe(stderrStream);

const sample = () => {
  try {
    memory.push({ phase: 'run', ...processMemory(child.pid) });
    write('memory.json', memory);
  } catch {
    // process may have exited
  }
};
sample();
const memTimer = setInterval(sample, 2000);

let timedOut = false;
const deadlineTimer = setTimeout(() => {
  timedOut = true;
  child.kill('SIGTERM');
  setTimeout(() => {
    try {
      child.kill('SIGKILL');
    } catch {
      // ignore
    }
  }, 5000);
}, Number(args.minutes || 20) * 60_000);

child.on('close', (code, signal) => {
  clearInterval(memTimer);
  clearTimeout(deadlineTimer);
  stdoutStream.end();
  stderrStream.end();
  metadata.endedAt = new Date().toISOString();
  metadata.wallMs = Date.parse(metadata.endedAt) - Date.parse(metadata.startedAt);
  metadata.exitCode = code;
  metadata.signal = signal;
  metadata.outcome = timedOut ? 'timeout' : code === 0 ? 'completed' : 'failed';
  write('metadata.json', metadata);
  write('memory.json', memory);
  console.log(`${metadata.setup}: ${metadata.outcome} (exit=${code}), ${(metadata.wallMs / 1000).toFixed(1)} s.`);
  if (code !== 0 && !timedOut) process.exitCode = 1;
});
