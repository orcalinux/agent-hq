import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { failureMessage, findOnPath, installScript, manualCommand, packageKind, runPackageInstall, runTerminalPackageInstall, shellQuote, terminalInstallCommand } from '../../electron/packageInstall';

describe('package install', () => {
  it('tells .deb and .rpm apart', () => {
    expect(packageKind('/tmp/agent-hq_1.0.0_amd64.deb')).toBe('deb');
    expect(packageKind('/tmp/agent-hq-1.0.0.x86_64.RPM')).toBe('rpm');
    expect(packageKind('/tmp/Agent-HQ.AppImage')).toBeNull();
  });

  it('quotes paths so spaces and quotes stay one argument', () => {
    expect(shellQuote("/tmp/it's here/a.deb")).toBe(`'/tmp/it'\\''s here/a.deb'`);
    expect(installScript('deb', '/tmp/a b.deb')).toBe(`dpkg -i '/tmp/a b.deb' || { apt-get install -f -y && dpkg -i '/tmp/a b.deb'; }`);
    expect(manualCommand('deb', '/tmp/a b.deb')).toBe(`sudo dpkg -i '/tmp/a b.deb'`);
    expect(manualCommand('rpm', '/tmp/a.rpm')).toBe(`sudo dnf install '/tmp/a.rpm'`);
  });

  it('explains how the installer ended', () => {
    expect(failureMessage({ code: 126 })).toMatch(/cancelled/);
    expect(failureMessage({ code: 127 })).toMatch(/authentication could not start/);
    expect(failureMessage({ code: null, timedOut: true })).toMatch(/not answered/);
    expect(failureMessage({ code: null, missing: true })).toMatch(/pkexec/);
    expect(failureMessage({ code: 100, stderr: 'a\nb\nc' })).toBe('The installer stopped with exit code 100: b c.');
  });

  it('offers a safe manual command if no terminal is available', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-'));
    const file = path.join(directory, 'a.deb');
    fs.writeFileSync(file, 'x');
    try {
      expect(await runTerminalPackageInstall(file, { searchPath: '/nonexistent' })).toMatchObject({
        ok: false, command: manualCommand('deb', file), message: expect.stringContaining('No supported terminal'),
      });
      const command = terminalInstallCommand('deb', "/tmp/it's here.deb", '/tmp/result');
      expect(command).toContain(shellQuote(installScript('deb', "/tmp/it's here.deb")));
      expect(command).toContain(`result=$?; printf '%s' "$result" > '/tmp/result'`);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform === 'linux')('waits for the install result instead of assuming that opening a terminal succeeded', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-terminal-'));
    const file = path.join(directory, 'a.deb');
    const terminal = path.join(directory, 'x-terminal-emulator');
    fs.writeFileSync(file, 'fixture');
    try {
      for (const exitCode of [0, 7]) {
        fs.writeFileSync(terminal, `#!${process.execPath}\nconst fs = require('fs');\nconst command = process.argv.at(-1);\nconst result = command.match(/> '([^']+\\/result)'/)[1];\nsetTimeout(() => fs.writeFileSync(result, '${exitCode}'), 30);\n`, { mode: 0o700 });
        const result = await runTerminalPackageInstall(file, { searchPath: directory, timeoutMs: 5000 });
        expect(result.ok).toBe(exitCode === 0);
        if (!result.ok) expect(result.message).toContain('exit code 7');
      }
      fs.writeFileSync(terminal, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
      const unreported = await runTerminalPackageInstall(file, { searchPath: directory, timeoutMs: 100 });
      expect(unreported).toMatchObject({ ok: false, message: expect.stringContaining('did not report') });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('only searches absolute PATH entries', () => {
    const executable = path.basename(process.execPath);
    expect(findOnPath(executable, path.dirname(process.execPath))).toBe(path.join(path.dirname(process.execPath), executable));
    expect(findOnPath(executable, ['bin', '.'].join(path.delimiter))).toBeNull();
  });

  it('fails without freezing when the file or pkexec is missing', async () => {
    const missing = await runPackageInstall('/nonexistent/a.deb');
    expect(missing.ok).toBe(false);
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pi-')), 'a.deb');
    fs.writeFileSync(file, 'x');
    const noPkexec = await runPackageInstall(file, { isRoot: false, searchPath: '/nonexistent' });
    expect(noPkexec).toMatchObject({ ok: false, command: `sudo dpkg -i '${file}'` });
    expect(noPkexec.ok === false && noPkexec.message).toMatch(/pkexec/);
  });

  it.runIf(process.platform === 'linux')('reports a failing installer and stays responsive while it runs', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-'));
    const file = path.join(dir, 'a.deb');
    fs.writeFileSync(file, 'not a package');
    let ticks = 0;
    const timer = setInterval(() => ticks++, 10);
    const result = await runPackageInstall(file, { isRoot: true });
    clearInterval(timer);
    expect(result.ok).toBe(false);
    expect(ticks).toBeGreaterThan(0);
  });
});
