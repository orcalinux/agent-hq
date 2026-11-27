import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { stageTaskWorkspace, verifyTaskWorkspace } from '../../server/taskWorkspaces';

const tempDirs: string[] = [];

function makeRepo(): { root: string; managedRoot: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ahq-worker-verify-'));
  tempDirs.push(dir);
  const root = path.join(dir, 'repo');
  const managedRoot = path.join(dir, 'workers');
  fs.mkdirSync(root, { recursive: true });
  execFileSync('git', ['init'], { cwd: root });
  execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: root });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'worker-verify-fixture',
    version: '1.0.0',
    scripts: {
      test: 'node --test math.test.mjs',
    },
  }));
  fs.writeFileSync(path.join(root, 'math.mjs'), 'export const add = (a, b) => a + b;\n');
  fs.writeFileSync(path.join(root, 'math.test.mjs'), 'import test from "node:test"; import assert from "node:assert/strict"; import { add } from "./math.mjs"; test("add", () => assert.equal(add(1, 2), 3));\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: root });
  return { root, managedRoot };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('per-worker Git worktree verification', () => {
  it('runs allow-listed verification inside the isolated worktree for passing and failing changes', async () => {
    const { root, managedRoot } = makeRepo();

    const passing = await stageTaskWorkspace(root, 'run-1', 't1', 1, [{ path: 'math.mjs', content: 'export const add = (a, b) => Number(a) + Number(b);\n' }], managedRoot);
    expect(passing.kind).toBe('worktree');
    const passRes = await verifyTaskWorkspace(root, passing.path!, 'npm test', 30_000, managedRoot);
    expect(passRes.ok).toBe(true);
    expect(passRes.exitCode).toBe(0);

    const failing = await stageTaskWorkspace(root, 'run-1', 't2', 1, [{ path: 'math.mjs', content: 'export const add = (a, b) => a - b;\n' }], managedRoot);
    expect(failing.kind).toBe('worktree');
    const failRes = await verifyTaskWorkspace(root, failing.path!, 'npm test', 30_000, managedRoot);
    expect(failRes.ok).toBe(false);
    expect(failRes.rejected).toBeUndefined();
    expect(failRes.exitCode).toBe(1);
    // Main repo remains clean and untouched
    expect(fs.readFileSync(path.join(root, 'math.mjs'), 'utf8')).toBe('export const add = (a, b) => a + b;\n');
  });

  it('rejects disallowed shell commands and worktree paths outside managedRoot or belonging to another repo', async () => {
    const { root, managedRoot } = makeRepo();
    const other = makeRepo();
    const staged = await stageTaskWorkspace(root, 'run-2', 't1', 1, [{ path: 'math.mjs', content: 'export const add = (a, b) => a + b;\n' }], managedRoot);

    const disallowed = await verifyTaskWorkspace(root, staged.path!, 'rm -rf .', 10_000, managedRoot);
    expect(disallowed.ok).toBe(false);
    expect(disallowed.rejected).toBe(true);

    await expect(verifyTaskWorkspace(root, root, 'npm test', 10_000, managedRoot)).rejects.toThrow(/isolated worker directory/);
    await expect(verifyTaskWorkspace(other.root, staged.path!, 'npm test', 10_000, managedRoot)).rejects.toThrow(/active Git repository/);
  });
});
