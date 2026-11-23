import { describe, expect, it } from 'vitest';
import { buildTerminalLaunch } from '../../server/terminal';
import { installCommandFor } from '../../server/installers';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const only = (...names: string[]) => (bin: string) => names.includes(bin);

describe('buildTerminalLaunch', () => {
  it('prefers $TERMINAL, then known emulators in order', () => {
    const launch = buildTerminalLaunch({ platform: 'linux', dir: '/work/app', shell: '/bin/zsh', preferred: 'kitty', isAvailable: only('kitty', 'xterm') });
    expect(launch).toEqual({ command: 'kitty', args: ['--directory', '/work/app', '/bin/zsh'], cwd: '/work/app' });
    expect(buildTerminalLaunch({ platform: 'linux', dir: '/w', isAvailable: only('konsole', 'xterm') })?.command).toBe('konsole');
  });

  it('opens gnome-terminal in the project and keeps the shell open after a command', () => {
    const launch = buildTerminalLaunch({ platform: 'linux', dir: '/w', shell: '/bin/bash', command: 'npm i -g x', isAvailable: only('gnome-terminal') });
    expect(launch?.args).toEqual(['--working-directory', '/w', '--', '/bin/bash', '-lc', "npm i -g x; exec '/bin/bash'"]);
  });

  it('returns null when no Linux terminal exists', () => {
    expect(buildTerminalLaunch({ platform: 'linux', dir: '/w', isAvailable: () => false })).toBeNull();
  });

  it.skipIf(process.platform === 'win32')('treats shell path substitutions as literal filenames', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hq-shell-'));
    try {
      const shell = path.join(dir, "shell'$(touch injected)");
      fs.writeFileSync(shell, '#!/bin/sh\nprintf shell-safe', { mode: 0o700 });
      const launch = buildTerminalLaunch({ platform: 'linux', dir, shell, command: 'true', isAvailable: only('xterm') })!;
      const output = execFileSync('/bin/sh', ['-c', launch.args.at(-1)!], { cwd: dir, encoding: 'utf8' });
      expect(output).toBe('shell-safe');
      expect(fs.existsSync(path.join(dir, 'injected'))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('handles macOS and Windows', () => {
    expect(buildTerminalLaunch({ platform: 'darwin', dir: '/w', isAvailable: () => true })).toEqual({ command: 'open', args: ['-a', 'Terminal', '/w'], cwd: '/w' });
    const mac = buildTerminalLaunch({ platform: 'darwin', dir: "/my dir's", command: 'echo "hi"', isAvailable: () => true });
    expect(mac?.args[3]).toBe(String.raw`tell application "Terminal" to do script "cd '/my dir'\\''s' && echo \"hi\""`);
    expect(buildTerminalLaunch({ platform: 'win32', dir: 'C:\\w', isAvailable: only('wt') })).toEqual({ command: 'wt', args: ['-d', 'C:\\w'], cwd: 'C:\\w' });
    expect(buildTerminalLaunch({ platform: 'win32', dir: 'C:\\w', isAvailable: () => false })?.command).toBe('cmd');
  });
});

describe('installCommandFor', () => {
  it('gives npm commands everywhere and sends Ollama and Magpie to downloads on Windows', () => {
    expect(installCommandFor('claude', 'linux')).toBe('npm i -g @anthropic-ai/claude-code');
    expect(installCommandFor('ollama', 'win32')).toBeNull();
    expect(installCommandFor('ollama', 'darwin')).toBeNull();
    expect(installCommandFor('magpie', 'linux')).toContain('usemagpie.ai/install.sh');
    expect(installCommandFor('nope', 'linux')).toBeNull();
    expect(installCommandFor('__proto__', 'linux')).toBeNull();
    expect(installCommandFor('constructor', 'linux')).toBeNull();
  });
});
