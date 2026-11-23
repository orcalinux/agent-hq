import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Play, SquareTerminal, Trash2, X } from 'lucide-react';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { useAgentStore, formatClock } from '@/store/useAgentStore';
import { useLayoutStore, type BottomTab } from '@/store/useLayoutStore';
import { applyProposedChange, revertProposedChange } from '@/engine/liveOrchestrator';
import { canRevert } from '@/engine/approval';
import { api } from '@/api/client';
import { Badge, Button, EmptyState, IconButton, Spinner, Tabs } from '@/components/ui/primitives';
import { fmtDuration } from '@/components/ui/helpers';
import { describeRepo } from '@/utils/repoSummary';
const TerminalPane = lazy(() => import('./TerminalPane').then((m) => ({ default: m.TerminalPane })));
import type { KanbanTaskCard, ProposedFileChange } from '@/types';
import { cn } from '@/utils/cn';
import { collapseContext, diffStats, lineDiff } from '@/utils/lineDiff';

/** What applying a proposal would change: a line diff against the file as it is now (or as it was before, once applied). */
function ProposalDiff({ change }: { change: ProposedFileChange }) {
  const [before, setBefore] = useState<string | null | undefined>(change.status === 'applied' ? change.previousContent : undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (before !== undefined) return;
    let live = true;
    api
      .readFileIfExists(change.path)
      .then((f) => live && setBefore(f.exists && !f.binary ? f.content : f.exists ? '' : null))
      .catch((err) => live && setError((err as Error).message));
    return () => {
      live = false;
    };
  }, [before, change.path]);
  const ops = useMemo(() => (before === undefined ? null : lineDiff(before, change.content)), [before, change.content]);
  if (error) return <p className="mt-1 text-[11.5px] text-danger">{error}</p>;
  if (!ops) return <div className="mt-1 flex justify-center py-2"><Spinner /></div>;
  const { added, removed } = diffStats(ops);
  return (
    <div className="mt-1 overflow-hidden rounded border border-line" data-testid="proposal-diff">
      <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-2 py-1 text-[11px] text-fg-subtle">
        <span className="min-w-0 flex-1 truncate">{before === null ? 'New file' : added + removed === 0 ? 'No change to the current file' : 'Compared with the file on disk'}</span>
        <span className="shrink-0 font-mono text-success">+{added}</span>
        <span className="shrink-0 font-mono text-danger">−{removed}</span>
      </div>
      <pre className="max-h-64 overflow-auto bg-surface font-mono text-[11.5px] leading-[1.45]">
        {collapseContext(ops).map((op, index) =>
          op.kind === 'gap' ? (
            <div key={index} className="select-none bg-surface-2 px-2 text-fg-subtle">⋯ {op.count} unchanged line{op.count === 1 ? '' : 's'}</div>
          ) : (
            <div key={index} className={cn('whitespace-pre px-2', op.kind === 'add' && 'bg-success/10 text-success', op.kind === 'del' && 'bg-danger/10 text-danger')}>
              <span aria-hidden className="mr-2 inline-block w-2 select-none opacity-70">{op.kind === 'add' ? '+' : op.kind === 'del' ? '−' : ' '}</span>
              {op.text || ' '}
            </div>
          ),
        )}
      </pre>
    </div>
  );
}

function CommandsTab() {
  const entries = useWorkspaceStore((s) => s.terminal);
  const run = useWorkspaceStore((s) => s.runCommand);
  const clear = useWorkspaceStore((s) => s.clearTerminal);
  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState<number | null>(null);
  const [allowed, setAllowed] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const history = useMemo(() => entries.map((e) => e.command), [entries]);
  const busy = entries.some((e) => e.running);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [entries]);
  useEffect(() => {
    api.allowedCommands().then((r) => setAllowed(r.commands.map((c) => (c.subcommands ? `${c.program} (${c.subcommands.join(', ')})` : c.program)).join(' · '))).catch(() => setAllowed(null));
  }, []);

  const submit = () => {
    const command = value.trim();
    if (!command || busy) return;
    setValue('');
    setCursor(null);
    void run(command);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[12px]">
        {entries.length === 0 ? (
          <p className="text-fg-subtle">Commands run in the project folder without a shell. {allowed ? `Allowed: ${allowed}.` : ''}</p>
        ) : null}
        {entries.map((e) => (
          <div key={e.id} className="mb-2">
            <div className="flex items-center gap-2 text-fg">
              <span className="text-accent">$</span>
              <span className="break-all">{e.command}</span>
              {e.running ? <Spinner className="h-3 w-3" /> : null}
              {!e.running && e.exitCode !== undefined ? <Badge tone={e.exitCode === 0 ? 'success' : 'danger'}>{e.rejected ? 'rejected' : `exit ${e.exitCode ?? '—'}`}</Badge> : null}
              {e.durationMs ? <span className="text-fg-subtle">{fmtDuration(e.durationMs)}</span> : null}
            </div>
            {e.stdout ? <pre className="whitespace-pre-wrap break-words text-fg-muted">{e.stdout}</pre> : null}
            {e.stderr ? <pre className="whitespace-pre-wrap break-words text-danger">{e.stderr}</pre> : null}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-1.5">
        <span className="font-mono text-[12px] text-accent">$</span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Terminal command"
          placeholder="npm test, git status, npx tsc --noEmit …"
          spellCheck={false}
          className="h-6 flex-1 bg-transparent font-mono text-[12px] placeholder:text-fg-subtle focus:outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            else if (e.key === 'ArrowUp' && history.length) {
              e.preventDefault();
              const next = cursor === null ? history.length - 1 : Math.max(0, cursor - 1);
              setCursor(next);
              setValue(history[next]);
            } else if (e.key === 'ArrowDown' && cursor !== null) {
              e.preventDefault();
              const next = cursor + 1;
              if (next >= history.length) {
                setCursor(null);
                setValue('');
              } else {
                setCursor(next);
                setValue(history[next]);
              }
            }
          }}
        />
        <IconButton icon={Trash2} label="Clear terminal" size="sm" onClick={clear} />
      </div>
    </div>
  );
}

const LEVEL_TEXT = { info: 'text-fg-muted', success: 'text-success', warn: 'text-warning', error: 'text-danger' } as const;

function LogsTab() {
  const activity = useAgentStore((s) => s.activity);
  const agents = useAgentStore((s) => s.agents);
  const rows = useMemo(() => activity.slice(-300), [activity]);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [rows.length]);
  if (rows.length === 0) return <EmptyState title="No agent activity yet">Logs appear here while agents work on an approved plan.</EmptyState>;
  return (
    <div className="h-full overflow-y-auto px-3 py-1.5 font-mono text-[11.5px]">
      {rows.map((e) => (
        <div key={e.id} className="log-row flex gap-2 py-px">
          <span className="shrink-0 text-fg-subtle">{formatClock(e.timestamp)}</span>
          <span className="w-16 shrink-0 truncate text-fg-muted">{e.agentId ? agents[e.agentId]?.name ?? e.agentId : e.kind}</span>
          <span className={cn('break-words', LEVEL_TEXT[e.level])}>{e.text}</span>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}

function ProblemsTab() {
  const problems = useWorkspaceStore((s) => s.problems);
  const running = useWorkspaceStore((s) => s.problemsRunning);
  const checkedAt = useWorkspaceStore((s) => s.problemsCheckedAt);
  const check = useWorkspaceStore((s) => s.runTypeCheck);
  const openFile = useWorkspaceStore((s) => s.openFile);
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-3 text-[12px] text-fg-muted">
        <Button size="sm" icon={Play} loading={running} onClick={() => void check()}>Run type check</Button>
        <span className="min-w-0 truncate">{checkedAt ? `${problems.length} problem${problems.length === 1 ? '' : 's'} · checked ${formatClock(checkedAt)}` : 'Runs npx tsc --noEmit in the project.'}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {checkedAt && problems.length === 0 ? <EmptyState title="No problems found" /> : null}
        {problems.map((p) => (
          <button key={p.id} type="button" onClick={() => void openFile(p.file)} className="flex w-full items-baseline gap-2 px-3 py-1 text-left text-[12px] hover:bg-surface-2">
            <Badge tone={p.severity === 'error' ? 'danger' : 'warning'}>{p.rule}</Badge>
            <span className="min-w-0 truncate text-fg">{p.message}</span>
            <span className="ml-auto min-w-0 max-w-[45%] shrink-0 truncate font-mono text-fg-subtle">{p.file}:{p.line}:{p.column}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const NO_PROPOSALS: ProposedFileChange[] = [];
const NO_TASKS: KanbanTaskCard[] = [];

function ChangesTab() {
  const git = useWorkspaceStore((s) => s.git);
  const repo = useMemo(() => describeRepo(git?.details), [git?.details]);
  const tree = useWorkspaceStore((s) => s.tree);
  const openFile = useWorkspaceStore((s) => s.openFile);
  const showDiff = useWorkspaceStore((s) => s.showDiff);
  const reload = useWorkspaceStore((s) => s.loadGit);
  const proposals = useAgentStore((s) => s.activeMission?.proposedChanges ?? NO_PROPOSALS);
  const tasks = useAgentStore((s) => s.activeMission?.tasks ?? NO_TASKS);
  const setStatus = useAgentStore((s) => s.setProposedChangeStatus);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = proposals.filter((p) => p.status === 'pending');

  const apply = async (id: string) => {
    setError(null);
    try {
      await applyProposedChange(id);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const undo = async (id: string) => {
    setError(null);
    try {
      await revertProposedChange(id);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      {error ? <p className="px-3 py-1 text-[12px] text-danger" role="alert">{error}</p> : null}
      <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
        Proposed by agents {pending.length ? `(${pending.length} pending)` : ''}
      </div>
      {proposals.length === 0 ? <p className="px-3 pb-2 text-[12px] text-fg-subtle">Agents propose file changes during a run. You review and apply them here, or turn on auto-apply in Settings to write QA-approved changes automatically.</p> : null}
      {proposals.map((p) => {
        const exists = tree.some((f) => f.path === p.path);
        return (
          <div key={p.id} className="border-b border-line px-3 py-1.5">
            <div className="flex items-center gap-2 text-[12px]">
              <button type="button" onClick={() => setOpen(open === p.id ? null : p.id)} aria-label={open === p.id ? 'Hide changes' : 'Show changes'} aria-expanded={open === p.id} className="shrink-0 text-fg-subtle">
                {open === p.id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
              <span className="min-w-0 flex-1 truncate font-mono">{p.path}</span>
              {p.autoApplied && p.status === 'applied' ? <Badge tone="accent">auto</Badge> : null}
              {p.status === 'pending' && p.conflictsWith?.length ? (
                <span title={`Also changed independently by: ${p.conflictsWith.map((id) => tasks.find((t) => t.id === id)?.title ?? id).join(', ')}. Applying this version discards the others.`}>
                  <Badge tone="danger">conflict</Badge>
                </span>
              ) : null}
              <Badge tone={p.status === 'applied' ? 'success' : p.status === 'discarded' || p.status === 'reverted' ? 'neutral' : 'warning'}>{exists || p.status !== 'pending' ? p.status : `new · ${p.status}`}</Badge>
              {canRevert(p) ? <Button size="sm" variant="ghost" onClick={() => void undo(p.id)}>Undo</Button> : null}
              {p.status === 'pending' ? (
                <>
                  {exists ? <Button size="sm" onClick={() => { showDiff({ path: p.path, content: p.content, label: 'agent proposal' }); void openFile(p.path); }}>Diff</Button> : null}
                  <Button size="sm" variant="primary" icon={Check} onClick={() => void apply(p.id)}>Apply</Button>
                  <IconButton icon={X} label="Discard proposal" size="sm" onClick={() => setStatus(p.id, 'discarded')} />
                </>
              ) : null}
            </div>
            {open === p.id ? <ProposalDiff change={p} /> : null}
          </div>
        );
      })}
      <div className="flex items-center justify-between gap-2 px-3 pb-1 pt-3">
        <span className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Working tree {git?.branch ? `· ${git.branch}` : ''}</span>
        <Button size="sm" variant="ghost" onClick={() => void reload()}>Refresh</Button>
      </div>
      {repo ? (
        <div className="mx-3 mb-2 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12px]">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="min-w-0 truncate font-mono">{repo.branch}</span>
            {repo.sync ? <Badge tone={repo.sync === 'up to date' ? 'success' : 'warning'}>{repo.sync}</Badge> : null}
            {repo.remote ? (
              repo.remoteUrl ? <a href={repo.remoteUrl} target="_blank" rel="noreferrer" className="min-w-0 truncate text-accent hover:underline" title={repo.remoteUrl}>{repo.remote}</a> : <span className="min-w-0 truncate text-fg-muted">{repo.remote}</span>
            ) : null}
          </div>
          {git?.details?.lastCommit ? <p className="mt-0.5 truncate text-fg-subtle" title={git.details.lastCommit.subject}>{git.details.lastCommit.hash} · {git.details.lastCommit.subject} · {git.details.lastCommit.when}</p> : null}
          {repo.hint ? <p className="mt-0.5 text-warning">{repo.hint}</p> : null}
        </div>
      ) : null}
      {!git ? <p className="px-3 pb-2 text-[12px] text-fg-subtle">Git status unavailable.</p> : null}
      {git && !git.isRepo ? <p className="px-3 pb-2 text-[12px] text-fg-subtle">This folder is not a git repository.</p> : null}
      {git?.isRepo && git.files.length === 0 ? <p className="px-3 pb-2 text-[12px] text-fg-subtle">No uncommitted changes.</p> : null}
      {git?.files.map((f) => (
        <button key={f.path} type="button" onClick={() => void openFile(f.path)} className="flex w-full items-center gap-2 px-3 py-0.5 text-left text-[12px] hover:bg-surface-2">
          <span className="w-5 shrink-0 font-mono text-warning">{f.status.trim() || 'M'}</span>
          <span className="min-w-0 truncate font-mono">{f.path}</span>
          {f.additions !== undefined ? <span className="ml-auto shrink-0 text-success">+{f.additions}</span> : null}
          {f.deletions !== undefined ? <span className="shrink-0 text-danger">−{f.deletions}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function BottomPanel() {
  const tab = useLayoutStore((s) => s.bottomTab);
  const setLayout = useLayoutStore((s) => s.set);
  const toggle = useLayoutStore((s) => s.toggle);
  const problemCount = useWorkspaceStore((s) => s.problems.length);
  const pendingChanges = useAgentStore((s) => (s.activeMission?.proposedChanges ?? []).filter((p) => p.status === 'pending').length);
  return (
    <div className="flex h-full min-w-0 flex-col bg-surface">
      <div className="flex h-8 shrink-0 items-center justify-between gap-1 border-b border-line px-1.5">
        <Tabs<BottomTab>
          label="Panel"
          value={tab}
          onChange={(t) => setLayout({ bottomTab: t })}
          items={[
            { id: 'terminal', label: 'Terminal' },
            { id: 'commands', label: 'Agent commands' },
            { id: 'logs', label: 'Agent logs' },
            { id: 'problems', label: 'Problems', count: problemCount },
            { id: 'changes', label: 'Changes', count: pendingChanges },
          ]}
        />
        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton icon={SquareTerminal} label="Open in external terminal app" size="sm" onClick={() => void api.openTerminal().catch(() => undefined)} />
          <IconButton icon={X} label="Hide panel" size="sm" onClick={() => toggle('bottomVisible')} />
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <div className={tab === 'terminal' ? 'h-full' : 'hidden'}>
          <Suspense fallback={<div className="grid h-full place-items-center"><Spinner /></div>}>
            <TerminalPane />
          </Suspense>
        </div>
        {tab === 'commands' && <CommandsTab />}
        {tab === 'logs' && <LogsTab />}
        {tab === 'problems' && <ProblemsTab />}
        {tab === 'changes' && <ChangesTab />}
      </div>
    </div>
  );
}
