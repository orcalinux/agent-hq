import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseAllowedCommand, resolveInside } from '../../server/security';

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
});
