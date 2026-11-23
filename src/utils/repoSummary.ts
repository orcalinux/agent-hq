import type { RepoDetails } from '@/api/client';

export interface RepoSummaryText {
  branch: string;
  sync: string | null;
  remote: string | null;
  remoteUrl: string | null;
  hint: string | null;
}

export function describeRepo(details: RepoDetails | null | undefined): RepoSummaryText | null {
  if (!details) return null;
  const branch = details.detached ? `detached at ${details.head ?? 'HEAD'}` : details.branch ?? 'no commits yet';
  let sync: string | null = null;
  if (details.upstream) {
    const parts = [details.ahead ? `↑${details.ahead}` : '', details.behind ? `↓${details.behind}` : ''].filter(Boolean);
    sync = parts.length ? parts.join(' ') : 'up to date';
  }
  const remote = details.remote ? (details.remote.owner && details.remote.repo ? `${details.remote.owner}/${details.remote.repo}` : details.remote.host) : null;
  let hint: string | null = null;
  if (!details.remote) hint = 'No remote is set, so agents cannot push or open pull requests.';
  else if (!details.hasCommits) hint = 'The repository has no commits yet.';
  else if (!details.upstream && details.branch) hint = `Branch ${details.branch} is not pushed yet.`;
  else if (details.remote.isGitHub && details.ghCli === 'missing') hint = 'Install the GitHub CLI (gh) to let agents open pull requests.';
  else if (details.remote.isGitHub && details.ghCli === 'unauthenticated') hint = 'Run “gh auth login” so agents can open pull requests.';
  return { branch, sync, remote, remoteUrl: details.remote?.isGitHub ? details.remote.webUrl ?? null : null, hint };
}
