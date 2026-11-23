import { describe, expect, it } from 'vitest';
import { describeRepo } from '../../src/utils/repoSummary';
import type { RepoDetails } from '../../src/api/client';

const base: RepoDetails = { hasCommits: true, branch: 'main', detached: false, ahead: 0, behind: 0, remote: null, ghCli: 'missing' };
const gh = { url: 'git@github.com:a/b.git', host: 'github.com', owner: 'a', repo: 'b', webUrl: 'https://github.com/a/b', isGitHub: true };

describe('describeRepo', () => {
  it('returns nothing outside a repository', () => {
    expect(describeRepo(null)).toBeNull();
    expect(describeRepo(undefined)).toBeNull();
  });
  it('warns when there is no remote', () => {
    expect(describeRepo(base)).toMatchObject({ branch: 'main', remote: null, hint: expect.stringContaining('No remote') });
  });
  it('shows ahead and behind counts', () => {
    expect(describeRepo({ ...base, remote: gh, upstream: 'origin/main', ahead: 2, behind: 1, ghCli: 'authenticated' })).toMatchObject({ sync: '↑2 ↓1', remote: 'a/b', remoteUrl: 'https://github.com/a/b', hint: null });
    expect(describeRepo({ ...base, remote: gh, upstream: 'origin/main', ghCli: 'authenticated' })?.sync).toBe('up to date');
  });
  it('explains unpushed branches, a missing gh and an unauthenticated gh', () => {
    expect(describeRepo({ ...base, remote: gh })?.hint).toContain('not pushed');
    expect(describeRepo({ ...base, remote: gh, upstream: 'origin/main' })?.hint).toContain('Install the GitHub CLI');
    expect(describeRepo({ ...base, remote: gh, upstream: 'origin/main', ghCli: 'unauthenticated' })?.hint).toContain('gh auth login');
  });
  it('handles detached HEAD and empty repositories', () => {
    expect(describeRepo({ ...base, branch: undefined, detached: true, head: 'abc1234' })?.branch).toBe('detached at abc1234');
    expect(describeRepo({ ...base, hasCommits: false, branch: undefined, remote: gh })?.hint).toContain('no commits');
  });
  it('does not link non-GitHub hosts', () => {
    const other = { url: 'https://gitlab.com/g/p.git', host: 'gitlab.com', owner: 'g', repo: 'p', isGitHub: false };
    expect(describeRepo({ ...base, remote: other, upstream: 'o/main' })).toMatchObject({ remote: 'g/p', remoteUrl: null, hint: null });
  });
});
