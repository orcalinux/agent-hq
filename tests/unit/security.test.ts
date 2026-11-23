import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { executionTimeoutMs, parseAllowedCommand, resolveInside } from '../../server/security';
import { deleteFile } from '../../server/workspace';

describe('terminal allowlist', () => {
  it('accepts allow-listed read-only commands', () => {
    expect(parseAllowedCommand('git status')).toMatchObject({ ok: true, program: 'git', args: ['status'] });
    expect(parseAllowedCommand('ls src')).toMatchObject({ ok: true });
  });

  it('rejects shell operators, unknown programs and other subcommands', () => {
    expect(parseAllowedCommand('ls; rm -rf .').ok).toBe(false);
    expect(parseAllowedCommand('rm file').ok).toBe(false);
    expect(parseAllowedCommand('git push').ok).toBe(false);
  });

  it('rejects paths outside the workspace, including inside --option=value', () => {
    expect(parseAllowedCommand('ls /etc').ok).toBe(false);
    expect(parseAllowedCommand('ls ../other').ok).toBe(false);
    expect(parseAllowedCommand('npx eslint --config=/tmp/evil.js').ok).toBe(false);
  });

  it('blocks git options that write files or run helpers', () => {
    expect(parseAllowedCommand('git diff --output=notes.txt').ok).toBe(false);
    expect(parseAllowedCommand('git log --ext-diff').ok).toBe(false);
  });

  it('never lets npx download packages', () => {
    expect(parseAllowedCommand('npx tsc --noEmit')).toMatchObject({ ok: true, program: 'npx', args: ['--no', '--', 'tsc', '--noEmit'] });
  });
});

describe('command execution timeout', () => {
  it('bounds numeric durations and replaces nonnumeric or nonfinite input', () => {
    for (const input of [undefined, null, '3000', NaN, Infinity, -Infinity, {}, []]) {
      expect(executionTimeoutMs(input)).toBe(120_000);
    }
    expect(executionTimeoutMs(-50)).toBe(1000);
    expect(executionTimeoutMs(0)).toBe(1000);
    expect(executionTimeoutMs(1800.9)).toBe(1800);
    expect(executionTimeoutMs(900_000)).toBe(600_000);
  });
});

describe('resolveInside', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hq-ws-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hq-out-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  fs.mkdirSync(path.join(root, 'src'));
  fs.symlinkSync(outside, path.join(root, 'link'));
  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('resolves existing and new paths inside the root', () => {
    expect(resolveInside(root, 'src')).toBe(path.join(root, 'src'));
    expect(resolveInside(root, 'src/new/file.ts')).toBe(path.join(root, 'src/new/file.ts'));
  });

  it('rejects traversal and symlinks that lead outside the root', () => {
    expect(resolveInside(root, '../x')).toBeNull();
    expect(resolveInside(root, 'link/secret.txt')).toBeNull();
    expect(resolveInside(root, 'link/new.txt')).toBeNull();
  });

  it('deleteFile removes files inside the root only', () => {
    fs.writeFileSync(path.join(root, 'src/tmp.ts'), 'x');
    deleteFile(root, 'src/tmp.ts');
    expect(fs.existsSync(path.join(root, 'src/tmp.ts'))).toBe(false);
    expect(() => deleteFile(root, 'src/missing.ts')).not.toThrow();
    expect(() => deleteFile(root, 'link/secret.txt')).toThrow(/inside the workspace/);
    expect(() => deleteFile(root, '../x')).toThrow(/inside the workspace/);
    expect(() => deleteFile(root, 'src')).toThrow(/not a file/);
    expect(fs.existsSync(path.join(outside, 'secret.txt'))).toBe(true);
  });
});

describe('test-runner commands', () => {
  it('allows the common test runners', () => {
    expect(parseAllowedCommand('python -m pytest -q')).toMatchObject({ ok: true, program: 'python', args: ['-m', 'pytest', '-q'] });
    expect(parseAllowedCommand('python3 -m unittest')).toMatchObject({ ok: true });
    expect(parseAllowedCommand('pytest tests/unit -x')).toMatchObject({ ok: true });
    expect(parseAllowedCommand('cargo test')).toMatchObject({ ok: true });
    expect(parseAllowedCommand('go test')).toMatchObject({ ok: true });
  });

  it('does not turn python or cargo into a general shell', () => {
    for (const line of ['python -c print(1)', 'python script.py', 'python -m http.server', 'python -m pip install x', 'python', 'cargo run', 'cargo install x', 'go run main.go', 'go install x']) {
      expect(parseAllowedCommand(line).ok, line).toBe(false);
    }
  });

  it('still keeps arguments inside the workspace', () => {
    expect(parseAllowedCommand('python -m pytest /etc').ok).toBe(false);
    expect(parseAllowedCommand('pytest ../other').ok).toBe(false);
    expect(parseAllowedCommand('python -m pytest -q; rm -rf .').ok).toBe(false);
  });
});
