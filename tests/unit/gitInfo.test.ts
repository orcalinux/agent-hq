import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { cloneRepository, parseRemote, repoDetails, resolveCloneSpec } from '../../server/gitInfo';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ahq-git-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'init.defaultBranch=main', ...args], { cwd, stdio: 'pipe' }).toString();

describe('parseRemote', () => {
  it('reads GitHub https, ssh and scp forms', () => {
    for (const url of ['https://github.com/acme/tool.git', 'https://github.com/acme/tool', 'git@github.com:acme/tool.git', 'ssh://git@github.com/acme/tool.git']) {
      expect(parseRemote(url)).toMatchObject({ host: 'github.com', owner: 'acme', repo: 'tool', isGitHub: true, webUrl: 'https://github.com/acme/tool' });
    }
  });
  it('marks other hosts as not GitHub and keeps the repo', () => {
    expect(parseRemote('https://gitlab.com/g/sub/proj.git')).toMatchObject({ host: 'gitlab.com', owner: 'sub', repo: 'proj', isGitHub: false });
    expect(parseRemote('https://gitlab.com/g/proj.git')?.webUrl).toBeUndefined();
  });
  it('strips credentials from nothing it returns for host and rejects junk', () => {
    expect(parseRemote('https://user:tok@github.com/a/b.git')?.host).toBe('github.com');
    expect(parseRemote('')).toBeNull();
    expect(parseRemote('/local/path/repo')).toBeNull();
  });
});

describe('resolveCloneSpec', () => {
  it('expands owner/repo to a GitHub https URL', () => {
    expect(resolveCloneSpec('orcalinux/agent-hq')).toEqual({ ok: true, url: 'https://github.com/orcalinux/agent-hq.git', name: 'agent-hq' });
  });
  it('accepts https and scp-style ssh', () => {
    expect(resolveCloneSpec('https://github.com/a/b.git')).toMatchObject({ ok: true, name: 'b' });
    expect(resolveCloneSpec('git@github.com:a/b.git')).toMatchObject({ ok: true, name: 'b' });
  });
  it('rejects option injection, local paths and dangerous transports', () => {
    for (const bad of ['', '--upload-pack=touch /tmp/x', '-c core.sshCommand=x', '/etc', '../x', 'file:///tmp/r', 'ext::sh -c id', 'git://github.com/a/b', 'https://github.com/a/b c', 'http://github.com/a/b.git']) {
      expect(resolveCloneSpec(bad).ok, bad).toBe(false);
    }
  });
});

describe('repoDetails', () => {
  it('returns null outside a repository', async () => {
    expect(await repoDetails(tmp)).toBeNull();
  });
  it('describes a fresh repository with no commits', async () => {
    const dir = path.join(tmp, 'fresh');
    fs.mkdirSync(dir);
    git(dir, 'init', '-q');
    expect(await repoDetails(dir)).toMatchObject({ hasCommits: false, branch: 'main', remote: null, ahead: 0, behind: 0 });
  });
  it('reads branch, GitHub remote, last commit and ahead count', async () => {
    const bare = path.join(tmp, 'origin.git');
    git(tmp, 'init', '-q', '--bare', bare);
    const dir = path.join(tmp, 'work');
    fs.mkdirSync(dir);
    git(dir, 'init', '-q');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
    git(dir, 'add', '.');
    git(dir, 'commit', '-qm', 'first');
    git(dir, 'remote', 'add', 'origin', bare);
    git(dir, 'push', '-q', '-u', 'origin', 'main');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b');
    git(dir, 'add', '.');
    git(dir, 'commit', '-qm', 'second');
    git(dir, 'remote', 'set-url', 'origin', 'git@github.com:acme/tool.git');
    const info = await repoDetails(dir);
    expect(info).toMatchObject({ hasCommits: true, branch: 'main', detached: false, upstream: 'origin/main', ahead: 1, behind: 0 });
    expect(info?.remote).toMatchObject({ isGitHub: true, owner: 'acme', repo: 'tool' });
    expect(info?.lastCommit?.subject).toBe('second');
  }, 20_000);
  it('reports a detached HEAD', async () => {
    const dir = path.join(tmp, 'work');
    git(dir, 'checkout', '-q', '--detach');
    expect(await repoDetails(dir)).toMatchObject({ detached: true, branch: undefined });
  });
});

describe('cloneRepository', () => {
  it('refuses bad input before touching the disk', async () => {
    expect(await cloneRepository(tmp, '--upload-pack=x')).toMatchObject({ ok: false, status: 400 });
    expect(await cloneRepository(path.join(tmp, 'nope'), 'https://github.com/a/b.git')).toMatchObject({ ok: false, status: 400 });
  });
  it('refuses to overwrite an existing folder', async () => {
    fs.mkdirSync(path.join(tmp, 'taken'));
    expect(await cloneRepository(tmp, 'https://github.com/a/taken.git')).toMatchObject({ ok: false, status: 409 });
  });
  it('reports a clone failure without leaving a folder behind', async () => {
    const result = await cloneRepository(tmp, 'https://127.0.0.1:1/a/missing.git');
    expect(result).toMatchObject({ ok: false, status: 502 });
    expect(fs.existsSync(path.join(tmp, 'missing'))).toBe(false);
  });
});
