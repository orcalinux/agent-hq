import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { failureMessage, findOnPath, installScript, manualCommand, packageKind, runPackageInstall, shellQuote } from '../../electron/packageInstall';

describe('package install', () => {
  it('tells .deb and .rpm apart', () => {
    expect(packageKind('/tmp/agent-hq_1.0.0_amd64.deb')).toBe('deb');
    expect(packageKind('/tmp/agent-hq-1.0.0.x86_64.RPM')).toBe('rpm');
    expect(packageKind('/tmp/Agent-HQ.AppImage')).toBeNull();
  });

  it('quotes paths so spaces and quotes stay one argument', () => {
    expect(shellQuote("/tmp/it's here/a.deb")).toBe(`'/tmp/it'\\''s here/a.deb'`);
    expect(installScript('deb', '/tmp/a b.deb')).toBe(`dpkg -i '/tmp/a b.deb' || apt-get install -f -y`);
    expect(manualCommand('deb', '/tmp/a b.deb')).toBe(`sudo dpkg -i '/tmp/a b.deb'`);
    expect(manualCommand('rpm', '/tmp/a.rpm')).toBe(`sudo dnf install '/tmp/a.rpm'`);
  });

  it('explains how the installer ended', () => {
    expect(failureMessage({ code: 126 })).toMatch(/cancelled/);
    expect(failureMessage({ code: 127 })).toMatch(/polkit/);
    expect(failureMessage({ code: null, timedOut: true })).toMatch(/not answered/);
    expect(failureMessage({ code: null, missing: true })).toMatch(/pkexec/);
    expect(failureMessage({ code: 100, stderr: 'a\nb\nc' })).toBe('The installer stopped with exit code 100: b c.');
  });

  it('only searches absolute PATH entries', () => {
    expect(findOnPath('sh', '/bin:/usr/bin')).toMatch(/sh$/);
    expect(findOnPath('sh', 'bin:.')).toBeNull();
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

  it('reports a failing installer and stays responsive while it runs', async () => {
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
