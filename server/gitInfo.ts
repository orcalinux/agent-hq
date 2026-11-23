import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';

export interface RemoteInfo {
  url: string;
  host: string;
  owner?: string;
  repo?: string;
  webUrl?: string;
  isGitHub: boolean;
}

export function parseRemote(raw: string): RemoteInfo | null {
  const url = raw.trim();
  if (!url) return null;
  let host = '';
  let repoPath = '';
  const scp = /^(?:[\w.-]+@)?([\w.-]+):(?!\/\/)(.+)$/.exec(url);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    try {
      const parsed = new URL(url);
      host = parsed.hostname.toLowerCase();
      repoPath = parsed.pathname.replace(/^\/+/, '');
    } catch {
      return null;
    }
  } else if (scp) {
    host = scp[1].toLowerCase();
    repoPath = scp[2];
  } else {
    return null;
  }
  repoPath = repoPath.replace(/\/+$/, '').replace(/\.git$/, '');
  const parts = repoPath.split('/').filter(Boolean);
  const isGitHub = host === 'github.com' || host === 'www.github.com';
  if (parts.length >= 2) {
    const [owner, repo] = [parts[parts.length - 2], parts[parts.length - 1]];
    return { url, host, owner, repo, isGitHub, webUrl: isGitHub ? `https://github.com/${owner}/${repo}` : undefined };
  }
  return { url, host, isGitHub };
}

export type CloneSpec = { ok: true; url: string; name: string } | { ok: false; error: string };

const SHORTHAND = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/;

export function resolveCloneSpec(input: string): CloneSpec {
  const text = input.trim();
  if (!text) return { ok: false, error: 'Enter a repository URL or owner/repo.' };
  if (text.startsWith('-') || /\s/.test(text)) return { ok: false, error: 'That is not a valid repository address.' };
  const short = SHORTHAND.exec(text);
  let url = text;
  if (short) url = `https://github.com/${short[1]}/${short[2].replace(/\.git$/, '')}.git`;
  const lower = url.toLowerCase();
  const allowed = lower.startsWith('https://') || lower.startsWith('ssh://') || /^[\w.-]+@[\w.-]+:[^/].*/.test(url);
  if (!allowed) return { ok: false, error: 'Use an https:// or ssh address, or owner/repo for GitHub. Local paths and other transports are not allowed.' };
  const remote = parseRemote(url);
  if (!remote?.repo) return { ok: false, error: 'Could not read a repository name from that address.' };
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(remote.repo) || remote.repo.includes('..')) {
    return { ok: false, error: 'The repository name contains characters that are not allowed in a folder name.' };
  }
  return { ok: true, url, name: remote.repo };
}

function run(cwd: string, program: string, args: string[], timeout = 8000): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) =>
    execFile(program, args, { cwd, timeout, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } }, (error, out, err) =>
      resolve({ code: error ? ((error as NodeJS.ErrnoException & { code?: number | string }).code === 'ENOENT' ? 127 : 1) : 0, out: String(out), err: String(err) })
    )
  );
}

export interface RepoDetails {
  hasCommits: boolean;
  head?: string;
  branch?: string;
  detached: boolean;
  upstream?: string;
  ahead: number;
  behind: number;
  remote: RemoteInfo | null;
  defaultBranch?: string;
  lastCommit?: { hash: string; subject: string; when: string };
  ghCli: 'authenticated' | 'unauthenticated' | 'missing';
}

export async function repoDetails(root: string): Promise<RepoDetails | null> {
  const inside = await run(root, 'git', ['rev-parse', '--is-inside-work-tree']);
  if (inside.code !== 0) return null;
  const head = await run(root, 'git', ['rev-parse', '--verify', '-q', 'HEAD']);
  const hasCommits = head.code === 0;
  const branchOut = (await run(root, 'git', ['symbolic-ref', '--short', '-q', 'HEAD'])).out.trim();
  const remoteName = (await run(root, 'git', ['remote'])).out.split('\n').find(Boolean);
  const remoteUrl = remoteName ? (await run(root, 'git', ['remote', 'get-url', remoteName])).out.trim() : '';
  const upstream = branchOut ? (await run(root, 'git', ['rev-parse', '--abbrev-ref', `${branchOut}@{upstream}`])).out.trim() : '';
  let ahead = 0;
  let behind = 0;
  if (upstream) {
    const counts = (await run(root, 'git', ['rev-list', '--left-right', '--count', `HEAD...${upstream}`])).out.trim().split(/\s+/);
    ahead = Number(counts[0]) || 0;
    behind = Number(counts[1]) || 0;
  }
  let defaultBranch: string | undefined;
  if (remoteName) {
    const sym = (await run(root, 'git', ['symbolic-ref', '--short', '-q', `refs/remotes/${remoteName}/HEAD`])).out.trim();
    if (sym) defaultBranch = sym.replace(`${remoteName}/`, '');
  }
  let lastCommit: RepoDetails['lastCommit'];
  if (hasCommits) {
    const line = (await run(root, 'git', ['log', '-1', '--format=%h%x09%s%x09%cr'])).out.trim().split('\t');
    if (line.length >= 3) lastCommit = { hash: line[0], subject: line[1], when: line[2] };
  }
  const remote = remoteUrl ? parseRemote(remoteUrl) : null;
  let ghCli: RepoDetails['ghCli'] = 'missing';
  if (remote?.isGitHub) {
    const auth = await run(root, 'gh', ['auth', 'status'], 4000);
    ghCli = auth.code === 127 ? 'missing' : auth.code === 0 ? 'authenticated' : 'unauthenticated';
  }
  return {
    hasCommits,
    head: hasCommits ? head.out.trim().slice(0, 7) : undefined,
    branch: branchOut || undefined,
    detached: !branchOut && hasCommits,
    upstream: upstream || undefined,
    ahead,
    behind,
    remote,
    defaultBranch,
    lastCommit,
    ghCli,
  };
}

export async function cloneRepository(parent: string, input: string, folderName?: string): Promise<{ ok: true; root: string; name: string } | { ok: false; status: number; error: string }> {
  const spec = resolveCloneSpec(input);
  if (!spec.ok) return { ok: false, status: 400, error: spec.error };
  const name = (folderName || '').trim() || spec.name;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name) || name.includes('..')) {
    return { ok: false, status: 400, error: 'Use a folder name made of letters, numbers, dots, dashes or underscores.' };
  }
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) return { ok: false, status: 400, error: `Parent folder not found: ${parent}` };
  const target = path.join(parent, name);
  if (fs.existsSync(target)) return { ok: false, status: 409, error: `A file or folder named "${name}" already exists in ${parent}.` };
  const result = await run(parent, 'git', ['-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'protocol.ssh.allow=always', 'clone', '--quiet', '--', spec.url, name], 300_000);
  if (result.code !== 0) {
    const reason = result.code === 127 ? 'git is not installed.' : result.err.trim().split('\n').slice(-3).join(' ') || 'git clone failed.';
    return { ok: false, status: 502, error: `Clone failed: ${reason}` };
  }
  return { ok: true, root: target, name };
}
