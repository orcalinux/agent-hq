import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const script = path.resolve('scripts/release-notes.mjs');
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;

describe('release note version matching', () => {
  it('selects the exact version, with or without the tag prefix', () => {
    const plain = spawnSync(process.execPath, [script, version], { encoding: 'utf8' });
    const tag = spawnSync(process.execPath, [script, `v${version}`], { encoding: 'utf8' });
    expect(plain.status).toBe(0);
    expect(tag.stdout).toBe(plain.stdout);
    expect(plain.stdout).toContain('### ');
  });

  it('treats regex syntax and backslashes as literal version text', () => {
    for (const input of ['.*', '(a+)+$', '[', '\\', `${version}|.*`, `${version}.0`]) {
      const result = spawnSync(process.execPath, [script, input], { encoding: 'utf8', timeout: 2000 });
      expect(result.status, input).toBe(1);
      expect(result.stderr).toContain('CHANGELOG.md has no section');
      expect(result.stdout).toBe('');
    }
  });
});
