import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { projectCommand, resolveSpawnTarget } from '../../server/execution';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function root() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hq-python-'));
  roots.push(directory);
  return directory;
}

function interpreter(directory: string, name: string, executable = true) {
  const file = path.join(directory, name, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '', { mode: executable ? 0o755 : 0o644 });
  return file;
}

describe('project Python environment', () => {
  it('uses the local .venv and preserves the supplied environment without mutating it', () => {
    const directory = root();
    const file = interpreter(directory, '.venv');
    interpreter(directory, 'venv');
    const env = { PATH: 'system-tools', CI: '1' };
    const result = projectCommand('python', directory, env);
    expect(result.program).toBe(file);
    expect(result.env.VIRTUAL_ENV).toBe(path.join(directory, '.venv'));
    expect(result.env.PATH).toBe(`${path.dirname(file)}${path.delimiter}system-tools`);
    expect(result.env.CI).toBe('1');
    expect(env.PATH).toBe('system-tools');
  });

  it('supports venv when .venv is absent', () => {
    const directory = root();
    expect(projectCommand('python', directory, {}).program).toBe('python');
    const file = interpreter(directory, 'venv');
    expect(projectCommand('python', directory, {}).program).toBe(file);
  });

  it('does not change other programs or the active environment when no local interpreter exists', () => {
    const directory = root();
    interpreter(directory, '.venv');
    const env = { PATH: 'active-env', VIRTUAL_ENV: 'selected-env' };
    expect(projectCommand('npm', directory, env)).toEqual({ program: 'npm', env });
    expect(projectCommand('python', root(), env)).toEqual({ program: 'python', env });
  });

  it.skipIf(process.platform === 'win32')('ignores a nonexecutable local interpreter', () => {
    const directory = root();
    interpreter(directory, '.venv', false);
    expect(projectCommand('python', directory, {}).program).toBe('python');
  });

  it('resolves bundled npm and npx CLI scripts for Windows spawn without shell', () => {
    const directory = root();
    const fakeNode = path.join(directory, 'node.exe');
    const cliJs = path.join(directory, 'node_modules', 'npm', 'bin', 'npm-cli.js');
    fs.writeFileSync(fakeNode, '');
    fs.mkdirSync(path.dirname(cliJs), { recursive: true });
    fs.writeFileSync(cliJs, '');

    expect(resolveSpawnTarget('npm', ['test'], {}, 'win32', fakeNode)).toEqual({
      program: fakeNode,
      args: [cliJs, 'test'],
    });
    expect(resolveSpawnTarget('npm', ['test'], {}, 'linux', fakeNode)).toEqual({
      program: 'npm',
      args: ['test'],
    });
    expect(resolveSpawnTarget('git', ['status'], {}, 'win32', fakeNode)).toEqual({
      program: 'git',
      args: ['status'],
    });
  });
});
