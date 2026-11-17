import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Play, Trash2, X } from 'lucide-react';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { useAgentStore, formatClock } from '@/store/useAgentStore';
import { useLayoutStore, type BottomTab } from '@/store/useLayoutStore';
import { applyProposedChange } from '@/engine/liveOrchestrator';
import { api } from '@/api/client';
import { Badge, Button, EmptyState, IconButton, Spinner, Tabs } from '@/components/ui/primitives';
import { fmtDuration } from '@/components/ui/helpers';
import { cn } from '@/utils/cn';

function TerminalTab() {
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
        <span>{checkedAt ? `${problems.length} problem${problems.length === 1 ? '' : 's'} · checked ${formatClock(checkedAt)}` : 'Runs npx tsc --noEmit in the project.'}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {checkedAt && problems.length === 0 ? <EmptyState title="No problems found" /> : null}
        {problems.map((p) => (
          <button key={p.id} type="button" onClick={() => void openFile(p.file)} className="flex w-full items-baseline gap-2 px-3 py-1 text-left text-[12px] hover:bg-surface-2">
            <Badge tone={p.severity === 'error' ? 'danger' : 'warning'}>{p.rule}</Badge>
            <span className="truncate text-fg">{p.message}</span>
            <span className="ml-auto shrink-0 font-mono text-fg-subtle">{p.file}:{p.line}:{p.column}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ChangesTab() {
  const git = useWorkspaceStore((s) => s.git);
  const tree = useWorkspaceStore((s) => s.tree);
  const openFile = useWorkspaceStore((s) => s.openFile);
  const showDiff = useWorkspaceStore((s) => s.showDiff);
  const reload = useWorkspaceStore((s) => s.loadGit);
  const proposals = useAgentStore((s) => s.activeMission?.proposedChanges ?? []);
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

  return (
    <div className="h-full overflow-y-auto">
      {error ? <p className="px-3 py-1 text-[12px] text-danger" role="alert">{error}</p> : null}
      <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
        Proposed by agents {pending.length ? `(${pending.length} pending)` : ''}
      </div>
      {proposals.length === 0 ? <p className="px-3 pb-2 text-[12px] text-fg-subtle">Agents propose file changes during a run. You review and apply them here; nothing is written automatically.</p> : null}
      {proposals.map((p) => {
        const exists = tree.some((f) => f.path === p.path);
        return (
          <div key={p.id} className="border-b border-line px-3 py-1.5">
            <div className="flex items-center gap-2 text-[12px]">
              <button type="button" onClick={() => setOpen(open === p.id ? null : p.id)} aria-label="Toggle preview" className="text-fg-subtle">
                {open === p.id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
              <span className="min-w-0 flex-1 truncate font-mono">{p.path}</span>
              <Badge tone={p.status === 'applied' ? 'success' : p.status === 'discarded' ? 'neutral' : 'warning'}>{exists ? p.status : `new · ${p.status}`}</Badge>
              {p.status === 'pending' ? (
                <>
                  {exists ? <Button size="sm" onClick={() => { showDiff({ path: p.path, content: p.content, label: 'agent proposal' }); void openFile(p.path); }}>Diff</Button> : null}
                  <Button size="sm" variant="primary" icon={Check} onClick={() => void apply(p.id)}>Apply</Button>
                  <IconButton icon={X} label="Discard proposal" size="sm" onClick={() => setStatus(p.id, 'discarded')} />
                </>
              ) : null}
            </div>
            {open === p.id ? <pre className="mt-1 max-h-48 overflow-auto rounded border border-line bg-surface-2 p-2 font-mono text-[11.5px]">{p.content}</pre> : null}
          </div>
        );
      })}
      <div className="flex items-center justify-between px-3 pb-1 pt-3">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Working tree {git?.branch ? `· ${git.branch}` : ''}</span>
        <Button size="sm" variant="ghost" onClick={() => void reload()}>Refresh</Button>
      </div>
      {!git ? <p className="px-3 pb-2 text-[12px] text-fg-subtle">Git status unavailable.</p> : null}
      {git && !git.isRepo ? <p className="px-3 pb-2 text-[12px] text-fg-subtle">This folder is not a git repository.</p> : null}
      {git?.isRepo && git.files.length === 0 ? <p className="px-3 pb-2 text-[12px] text-fg-subtle">No uncommitted changes.</p> : null}
      {git?.files.map((f) => (
        <button key={f.path} type="button" onClick={() => void openFile(f.path)} className="flex w-full items-center gap-2 px-3 py-0.5 text-left text-[12px] hover:bg-surface-2">
          <span className="w-5 font-mono text-warning">{f.status.trim() || 'M'}</span>
          <span className="truncate font-mono">{f.path}</span>
          {f.additions !== undefined ? <span className="ml-auto text-success">+{f.additions}</span> : null}
          {f.deletions !== undefined ? <span className="text-danger">−{f.deletions}</span> : null}
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
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-line px-1.5">
        <Tabs<BottomTab>
          label="Panel"
          value={tab}
          onChange={(t) => setLayout({ bottomTab: t })}
          items={[
            { id: 'terminal', label: 'Terminal' },
            { id: 'logs', label: 'Agent logs' },
            { id: 'problems', label: 'Problems', count: problemCount },
            { id: 'changes', label: 'Changes', count: pendingChanges },
          ]}
        />
        <IconButton icon={X} label="Hide panel" size="sm" onClick={() => toggle('bottomVisible')} />
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'terminal' && <TerminalTab />}
        {tab === 'logs' && <LogsTab />}
        {tab === 'problems' && <ProblemsTab />}
        {tab === 'changes' && <ChangesTab />}
      </div>
    </div>
  );
}
