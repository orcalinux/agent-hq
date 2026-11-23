import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { configDir, loadConfig } from './config';
import { resolveInside } from './security';
import { writeFile } from './workspace';

export interface TaskWorkspace {
  kind: 'worktree' | 'proposals';
  path?: string;
  reason?: string;
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
    top = fs.realpathSync((await git(root, ['rev-parse', '--show-toplevel'])).trim());
  } catch {
    return { kind: 'proposals', reason: 'This folder is not a Git repository; changes stay in the proposal review flow.' };
  }
  if (fs.realpathSync(root) !== top) return { kind: 'proposals', reason: 'Open the repository root to enable worktree snapshots.' };
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
