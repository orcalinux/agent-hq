import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { configDir, loadConfig } from './config';
import { executionTimeoutMs, parseAllowedCommand, resolveInside } from './security';
import { projectCommand, resolveSpawnTarget } from './execution';
import { writeFile } from './workspace';

export interface TaskWorkspace {
  kind: 'worktree' | 'proposals';
  path?: string;
  reason?: string;
}

export interface WorkerVerifyResult {
  ok: boolean;
  rejected?: boolean;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
}

function git(root: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile('git', ['-c', `core.hooksPath=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`, ...args], {
      cwd: root, timeout: 30_000, maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
    }, (error, stdout, stderr) => error ? reject(new Error(String(stderr).trim() || error.message)) : resolve(String(stdout)));
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(input);
  });
}

function safeFile(root: string, relative: string): string {
  if (relative.replace(/\\/g, '/').split('/').some((part) => part.toLowerCase() === '.git')) throw new Error('Worker files cannot modify Git metadata.');
  const resolved = resolveInside(root, relative);
  if (!resolved) throw new Error('Worker files must stay inside their worktree.');
  if (fs.existsSync(resolved) && path.relative(fs.realpathSync(root), fs.realpathSync(resolved)).split(path.sep).some((part) => part.toLowerCase() === '.git')) {
    throw new Error('Worker files cannot follow links into Git metadata.');
  }
  return resolved;
}

const locks = new Map<string, Promise<unknown>>();

export async function stageTaskWorkspace(
  root: string,
  runId: string,
  taskId: string,
  attempt: number,
  files: Array<{ path: string; content: string }>,
  managedRoot = path.join(configDir(), 'workers'),
): Promise<TaskWorkspace> {
  if (loadConfig().workerIsolation === 'proposals') return { kind: 'proposals', reason: 'Worktree snapshots are disabled in Settings.' };
  if (!runId || !taskId || !Number.isSafeInteger(attempt) || attempt < 1) throw new Error('A run, task and positive attempt are required.');
  for (const file of files) safeFile(root, file.path);
  let top: string;
  try {
    top = fs.realpathSync.native((await git(root, ['rev-parse', '--show-toplevel'])).trim());
  } catch {
    return { kind: 'proposals', reason: 'This folder is not a Git repository; changes stay in the proposal review flow.' };
  }
  if (path.relative(fs.realpathSync.native(root), top) !== '') return { kind: 'proposals', reason: 'Open the repository root to enable worktree snapshots.' };
  const relativeStorage = path.relative(top, path.resolve(managedRoot));
  if (!relativeStorage || (!relativeStorage.startsWith(`..${path.sep}`) && relativeStorage !== '..' && !path.isAbsolute(relativeStorage))) {
    throw new Error('Worker recovery storage must be outside the project repository.');
  }
  try {
    await git(root, ['rev-parse', '--verify', 'HEAD']);
  } catch {
    return { kind: 'proposals', reason: 'Make the first Git commit to enable worktree snapshots.' };
  }
  const previous = locks.get(top) ?? Promise.resolve();
  const operation = previous.catch(() => undefined).then(async (): Promise<TaskWorkspace> => {
    fs.mkdirSync(managedRoot, { recursive: true, mode: 0o700 });
    const key = createHash('sha256').update(`${top}\0${runId}\0${taskId}\0${attempt}`).digest('hex').slice(0, 32);
    const destination = path.join(fs.realpathSync(managedRoot), key);
    if (fs.existsSync(destination)) throw new Error('This task attempt already has a preserved worktree. Retry with a new attempt.');
    const patch = await git(root, ['diff', '--binary', 'HEAD', '--']);
    const untracked = (await git(root, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean);
    const copies: Array<{ path: string; bytes: Buffer }> = [];
    let total = Buffer.byteLength(patch);
    for (const relative of untracked) {
      const source = safeFile(root, relative);
      if (!fs.lstatSync(source).isFile()) throw new Error(`Cannot snapshot an untracked link or special file: ${relative}`);
      const size = fs.statSync(source).size;
      total += size;
      if (total > 32 * 1024 * 1024) throw new Error('Uncommitted project data exceeds the 32 MB worktree snapshot limit. Commit large files or use proposal isolation in Settings.');
      copies.push({ path: relative, bytes: fs.readFileSync(source) });
    }
    await git(root, ['worktree', 'add', '--detach', destination, 'HEAD']);
    try {
      if (patch) await git(destination, ['apply', '--binary', '--whitespace=nowarn', '-'], patch);
      for (const copy of copies) {
        const target = safeFile(destination, copy.path);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, copy.bytes);
      }
      for (const file of files) {
        safeFile(destination, file.path);
        writeFile(destination, file.path, file.content, { overwrite: true });
      }
      fs.writeFileSync(`${destination}.json`, JSON.stringify({ root: top, runId, taskId, attempt, savedAt: Date.now(), files: files.map((file) => file.path) }), { mode: 0o600 });
      return { kind: 'worktree', path: destination };
    } catch (cause) {
      throw new Error(`Worker snapshot failed; partial files remain at ${destination} for inspection. ${(cause as Error).message}`);
    }
  });
  locks.set(top, operation);
  try {
    return await operation;
  } finally {
    if (locks.get(top) === operation) locks.delete(top);
  }
}

export async function verifyTaskWorkspace(
  workspaceRoot: string,
  worktreePath: string,
  command: string,
  timeoutMs?: unknown,
  managedRoot = path.join(configDir(), 'workers'),
): Promise<WorkerVerifyResult> {
  const parsed = parseAllowedCommand(command);
  if (!parsed.ok) {
    return { ok: false, rejected: true, command, stdout: '', stderr: parsed.error ?? 'Command not allowed.', exitCode: null, durationMs: 0 };
  }
  if (!worktreePath || !fs.existsSync(managedRoot)) {
    throw new Error('Worktree path is invalid or workers directory does not exist.');
  }
  const realManaged = fs.realpathSync.native(managedRoot);
  let realWorktree: string;
  try {
    realWorktree = fs.realpathSync.native(worktreePath);
  } catch {
    throw new Error('Worktree directory does not exist.');
  }
  const rel = path.relative(realManaged, realWorktree);
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel) || rel.includes(path.sep)) {
    throw new Error('Verification is allowed only inside an isolated worker directory.');
  }
  if (!fs.statSync(realWorktree).isDirectory()) {
    throw new Error('Worktree path must be a directory.');
  }
  const sidecarPath = `${realWorktree}.json`;
  if (!fs.existsSync(sidecarPath)) {
    throw new Error('Worktree metadata file is missing.');
  }
  let top: string;
  try {
    top = fs.realpathSync.native((await git(workspaceRoot, ['rev-parse', '--show-toplevel'])).trim());
  } catch {
    throw new Error('Workspace root is not a Git repository.');
  }
  const meta = JSON.parse(fs.readFileSync(sidecarPath, 'utf8')) as { root?: unknown };
  if (typeof meta.root !== 'string' || fs.realpathSync.native(meta.root) !== top) {
    throw new Error('Worktree does not belong to the active Git repository.');
  }
  const start = Date.now();
  const execution = projectCommand(parsed.program!, workspaceRoot, { ...process.env, FORCE_COLOR: '0', CI: '1' });
  const target = resolveSpawnTarget(execution.program, parsed.args!, execution.env);
  const limit = 512 * 1024;
  const durationLimit = executionTimeoutMs(timeoutMs);
  return new Promise<WorkerVerifyResult>((resolve) => {
    const child = spawn(target.program, target.args, { cwd: realWorktree, env: execution.env, shell: false });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (res: WorkerVerifyResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(res);
    };
    const timer = setTimeout(() => child.kill('SIGTERM'), durationLimit);
    child.stdout.on('data', (d) => { stdout = (stdout + d).slice(-limit); });
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-limit); });
    child.on('error', (err) => {
      finish({ ok: false, command, stdout, stderr: err.message, exitCode: null, durationMs: Date.now() - start });
    });
    child.on('close', (code, signal) => {
      finish({
        ok: code === 0,
        command,
        stdout,
        stderr: signal ? `${stderr}\n[terminated: ${signal}]` : stderr,
        exitCode: code,
        durationMs: Date.now() - start,
      });
    });
  });
}
