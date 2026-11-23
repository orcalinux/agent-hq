import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { stageTaskWorkspace } from '../../server/taskWorkspaces';
import { resetConfigCache } from '../../server/config';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ahq-workers-'));
const previousConfig = process.env.AGENT_HQ_CONFIG_DIR;
process.env.AGENT_HQ_CONFIG_DIR = path.join(scratch, 'config');
resetConfigCache();
const root = path.join(scratch, 'repo');
const managed = path.join(scratch, 'workers');
fs.mkdirSync(root);
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' }).toString();
git('init', '-q');
fs.writeFileSync(path.join(root, 'shared.py'), 'original\n');
fs.writeFileSync(path.join(root, 'other.py'), 'base\n');
fs.writeFileSync(path.join(root, '.gitignore'), 'ignored.txt\n');
git('add', '.');
git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'starter');
afterAll(() => {
  if (previousConfig === undefined) delete process.env.AGENT_HQ_CONFIG_DIR;
  else process.env.AGENT_HQ_CONFIG_DIR = previousConfig;
  resetConfigCache();
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe('real Git worker snapshots', () => {
  it('isolates parallel edits and includes tracked and untracked project changes', async () => {
    fs.writeFileSync(path.join(root, 'other.py'), 'user edit\n');
    fs.writeFileSync(path.join(root, 'untracked.py'), 'user file\n');
    fs.writeFileSync(path.join(root, 'ignored.txt'), 'ignored data\n');
    const results = await Promise.all([
      stageTaskWorkspace(root, 'run', 'first', 1, [{ path: 'shared.py', content: 'worker one\n' }], managed),
      stageTaskWorkspace(root, 'run', 'second', 1, [{ path: 'shared.py', content: 'worker two\n' }], managed),
    ]);
    expect(results.every((result) => result.kind === 'worktree')).toBe(true);
    expect(results[0].path).not.toBe(results[1].path);
    for (const [index, result] of results.entries()) {
      expect(fs.readFileSync(path.join(result.path!, 'shared.py'), 'utf8')).toBe(index === 0 ? 'worker one\n' : 'worker two\n');
      expect(fs.readFileSync(path.join(result.path!, 'other.py'), 'utf8')).toBe('user edit\n');
      expect(fs.readFileSync(path.join(result.path!, 'untracked.py'), 'utf8')).toBe('user file\n');
      expect(fs.existsSync(path.join(result.path!, 'ignored.txt'))).toBe(false);
      expect(execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: result.path }).toString().trim()).toBe('HEAD');
    }
    expect(fs.readFileSync(path.join(root, 'shared.py'), 'utf8')).toBe('original\n');
    expect(fs.readFileSync(path.join(root, 'other.py'), 'utf8')).toBe('user edit\n');
  });

  it('keeps earlier attempts and refuses path escape and Git metadata writes', async () => {
    await expect(stageTaskWorkspace(root, 'run', 'first', 1, [], managed)).rejects.toThrow(/preserved/);
    const next = await stageTaskWorkspace(root, 'run', 'first', 2, [{ path: 'shared.py', content: 'rework\n' }], managed);
    expect(fs.readFileSync(path.join(next.path!, 'shared.py'), 'utf8')).toBe('rework\n');
    for (const relative of ['../escape.py', '.git/config']) {
      await expect(stageTaskWorkspace(root, 'run', 'unsafe', 1, [{ path: relative, content: 'bad' }], managed)).rejects.toThrow();
    }
  });

  it('reports proposal mode for non-Git folders and repositories without commits', async () => {
    const empty = path.join(scratch, 'empty');
    fs.mkdirSync(empty);
    expect(await stageTaskWorkspace(empty, 'run', 'task', 1, [], managed)).toMatchObject({ kind: 'proposals', reason: expect.stringContaining('not a Git') });
    execFileSync('git', ['init', '-q'], { cwd: empty });
    expect(await stageTaskWorkspace(empty, 'run', 'task', 1, [], managed)).toMatchObject({ kind: 'proposals', reason: expect.stringContaining('first Git commit') });
  });
});
