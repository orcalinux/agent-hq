import { useState } from 'react';
import { ArrowRight, FolderGit2, FolderOpen, FolderPlus, GitFork } from 'lucide-react';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { useAgentStore } from '@/store/useAgentStore';
import { Button, Kbd, Truncate } from '@/components/ui/primitives';

export function GetStarted() {
  const root = useWorkspaceStore((state) => state.root);
  const name = useWorkspaceStore((state) => state.name);
  const recent = useWorkspaceStore((state) => state.recent);
  const locked = useWorkspaceStore((state) => state.lockedByEnv);
  const running = useAgentStore((state) => state.isLiveRunning);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const blocked = locked || running || busy;
  const choose = (tab: 'open' | 'clone' | 'new') => {
    window.dispatchEvent(new CustomEvent('agent-hq:open-project', { detail: { tab } }));
  };
  const openRecent = async (path: string) => {
    setBusy(true);
    setError('');
    try {
      await useWorkspaceStore.getState().setRoot(path);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-8" data-testid="get-started">
      <div className="mx-auto w-full max-w-xl space-y-6">
        <div>
          <FolderGit2 aria-hidden className="mb-3 h-7 w-7 text-accent" />
          <h1 className="text-lg font-semibold">Your next project starts here</h1>
          <p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">Open a local folder or clone a repository, then ask Sovereign to plan and build with your team.</p>
        </div>
        {root ? (
          <div className="min-w-0 rounded-lg border border-line bg-surface px-3 py-2.5">
            <Truncate className="text-[12.5px] font-medium">{name || 'Current project'}</Truncate>
            <Truncate className="mt-0.5 font-mono text-[11.5px] text-fg-subtle">{root}</Truncate>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button icon={FolderOpen} disabled={blocked} onClick={() => choose('open')}>Open folder</Button>
          <Button icon={GitFork} disabled={blocked} onClick={() => choose('clone')}>Clone repository</Button>
          <Button icon={FolderPlus} disabled={blocked} onClick={() => choose('new')}>New project</Button>
        </div>
        {locked || running ? <p className="text-[11.5px] text-fg-subtle">{locked ? 'This session uses a fixed project folder.' : 'Finish or stop the current run before switching projects.'}</p> : null}
        {recent.filter((path) => path !== root).length ? (
          <section aria-label="Recent projects">
            <h2 className="mb-2 text-[11.5px] font-medium uppercase tracking-wide text-fg-subtle">Recent projects</h2>
            <div className="divide-y divide-line rounded-lg border border-line bg-surface">
              {recent.filter((path) => path !== root).slice(0, 8).map((path) => (
                <button key={path} type="button" disabled={blocked} onClick={() => void openRecent(path)} className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left hover:bg-surface-2 disabled:opacity-50">
                  <FolderOpen aria-hidden className="h-4 w-4 shrink-0 text-fg-subtle" />
                  <span className="min-w-0 flex-1">
                    <Truncate className="text-[12.5px]">{path.split(/[\\/]/).filter(Boolean).pop() || path}</Truncate>
                    <Truncate className="font-mono text-[11px] text-fg-subtle">{path}</Truncate>
                  </span>
                  <ArrowRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                </button>
              ))}
            </div>
          </section>
        ) : null}
        {error ? <p role="alert" className="text-[12px] text-danger">{error}</p> : null}
        <p className="text-[11.5px] leading-relaxed text-fg-subtle">Pick a file in the explorer or press <Kbd>Ctrl K</Kbd> to search. Start a task in the chat panel; your approval settings control when changes reach disk.</p>
      </div>
    </div>
  );
}
