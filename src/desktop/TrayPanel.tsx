import { useEffect, useState } from 'react';
import { Activity, ArrowUpRight, ChevronRight, CircleArrowUp, FolderOpen, Settings, Users, X } from 'lucide-react';
import { Badge, Button, IconButton, StatusDot, Tabs } from '@/components/ui/primitives';
import { fmtRelative, fmtTokens, statusTone, usageCostLabel } from '@/components/ui/helpers';
import type { TrayAction, TrayState } from './types';

type Tab = 'overview' | 'agents' | 'activity';

export function TrayPanel() {
  const api = window.agentHqTray;
  const [state, setState] = useState<TrayState | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [, tick] = useState(0);
  const act = (action: TrayAction) => api?.action(action);

  useEffect(() => {
    if (!api) return;
    let live = true;
    let pushed = false;
    const apply = (next: TrayState) => {
      if (!live || !next) return;
      document.documentElement.dataset.theme = next.theme;
      setState(next);
      setFailed(false);
    };
    const off = api.onState((next) => { pushed = true; apply(next); });
    void api.getState().then((next) => { if (!pushed) apply(next); }).catch(() => { if (live) setFailed(true); });
    const timer = setInterval(() => { if (!document.hidden) tick((value) => value + 1); }, 30_000);
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') api.action({ type: 'hide' }); };
    window.addEventListener('keydown', escape);
    return () => { live = false; off(); clearInterval(timer); window.removeEventListener('keydown', escape); };
  }, [api]);

  const mission = state?.mission;
  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden border border-line-strong bg-canvas" data-testid="tray-panel">
      <header className="flex shrink-0 items-center gap-2.5 border-b border-line bg-surface px-4 py-3">
        <img src="/logo.svg" alt="" className="h-7 w-7" />
        <div className="min-w-0 flex-1">
          <h1 className="text-[13px] font-semibold">Agent HQ</h1>
          <p className="text-[11px] text-fg-subtle">Quick status</p>
        </div>
        <IconButton icon={ArrowUpRight} label="Open main window" disabled={!api} onClick={() => act({ type: 'open' })} />
        <IconButton icon={Settings} label="Settings" disabled={!api} onClick={() => act({ type: 'open', view: 'settings' })} />
        <IconButton icon={X} label="Close quick status" disabled={!api} onClick={() => act({ type: 'hide' })} />
      </header>

      {state ? (
        <>
          <div className="shrink-0 space-y-3 px-4 pb-3 pt-3.5">
            <button type="button" className="flex w-full items-center gap-2 rounded-lg text-left text-[12px] text-fg-muted hover:text-fg" onClick={() => act({ type: 'open', view: 'workspace' })} title={state.projectPath}>
              <FolderOpen aria-hidden className="h-4 w-4 shrink-0 text-fg-subtle" />
              <span className="min-w-0 flex-1 truncate">{state.project || 'Choose a project'}</span>
              <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
            </button>
            <div className="flex items-center gap-2" role="status">
              <StatusDot tone={state.running ? 'accent' : mission?.failed ? 'danger' : 'neutral'} />
              <p className="min-w-0 flex-1 truncate text-[13px] font-medium">{state.label}</p>
              {mission?.source === 'simulation' ? <Badge tone="warning">Demo run</Badge> : null}
            </div>
            <Tabs<Tab> label="Quick status sections" value={tab} onChange={setTab} items={[
              { id: 'overview', label: 'Overview' },
              { id: 'agents', label: 'Agents', count: state.totalAgents },
              { id: 'activity', label: 'Activity' },
            ]} />
          </div>
          <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-4" role="tabpanel" aria-label={tab === 'overview' ? 'Overview' : tab === 'agents' ? 'Agents' : 'Activity'}>
            {tab === 'overview' ? (
              <div className="space-y-3">
                <section aria-label="Current run" className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
                  <div className="flex items-center justify-between border-b border-line px-3 py-2">
                    <h2 className="text-[12px] font-medium text-fg-muted">Current run</h2>
                    <Button size="sm" variant="ghost" onClick={() => act({ type: 'open', view: 'tasks' })}>View tasks <ChevronRight aria-hidden className="h-3 w-3" /></Button>
                  </div>
                  <div className="space-y-2.5 p-3">
                    <p className="line-clamp-3 break-words text-[13px] font-medium [overflow-wrap:anywhere]">{mission?.title || 'Ready when you are'}</p>
                    {mission ? (
                      <>
                        <div className="flex flex-wrap justify-between gap-2 text-[11.5px] text-fg-muted">
                          <span>{mission.completed} of {mission.total} tasks completed</span>
                          {mission.failed > 0 ? <span className="text-danger">{mission.failed} failed</span> : null}
                        </div>
                        <div role="progressbar" aria-label="Task completion" aria-valuemin={0} aria-valuemax={Math.max(1, mission.total)} aria-valuenow={mission.completed} className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                          <div className="h-full rounded-full bg-accent" style={{ width: `${mission.total ? mission.completed / mission.total * 100 : 0}%` }} />
                        </div>
                      </>
                    ) : <p className="text-[12px] text-fg-muted">Start a task from Workspace. Its progress will appear here.</p>}
                  </div>
                </section>
                {mission && mission.review > 0 ? (
                  <button type="button" onClick={() => act({ type: 'open', view: 'workspace' })} className="flex w-full items-center gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-left text-[12px] text-warning">
                    <Activity aria-hidden className="h-4 w-4 shrink-0" />
                    <span className="flex-1">{mission.review} change{mission.review === 1 ? '' : 's'} ready to review</span>
                    <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0" />
                  </button>
                ) : null}
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Agents', value: state.totalAgents, hint: `${state.busy} working`, view: 'agents' as const },
                    { label: 'Providers', value: state.connectedProviders, hint: `of ${state.totalProviders} connected`, view: 'connections' as const },
                    { label: 'Tokens', value: state.usage.calls ? fmtTokens(state.usage.totalTokens) : '—', hint: 'Recorded usage', view: 'reports' as const },
                  ].map((item) => (
                    <button key={item.label} type="button" onClick={() => act({ type: 'open', view: item.view })} className="min-w-0 rounded-xl border border-line bg-surface px-3 py-2.5 text-left shadow-card transition-colors hover:bg-surface-2">
                      <span className="block text-[11px] text-fg-muted">{item.label}</span>
                      <span className="mt-0.5 block truncate text-[20px] font-semibold tracking-tight tabular-nums">{item.value}</span>
                      <span className="mt-1 block text-[10.5px] text-fg-subtle">{item.hint}</span>
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap justify-between gap-1 px-0.5 text-[11.5px] text-fg-muted">
                  <span>{state.usage.calls} recorded calls</span>
                  <span>Estimated cost: {usageCostLabel(state.usage)}</span>
                </div>
                {state.update.status === 'ready' ? (
                  <button type="button" onClick={() => act({ type: 'updates' })} className="flex w-full items-center gap-2 rounded-xl border border-accent/25 bg-accent-soft px-3 py-2.5 text-left">
                    <CircleArrowUp aria-hidden className="h-4 w-4 shrink-0 text-accent" />
                    <span className="min-w-0 flex-1 text-[12px]">v{state.update.version} is ready <span className="block text-[11px] text-fg-muted">Read what changed before updating</span></span>
                    <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-fg-subtle" />
                  </button>
                ) : state.update.status === 'downloading' ? <p className="text-[11.5px] text-fg-muted">Downloading update · {Math.round(state.update.percent ?? 0)}%</p> : null}
              </div>
            ) : tab === 'agents' ? (
              <section aria-label="Team models" className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
                {state.agents.length ? state.agents.map((agent) => (
                  <button key={agent.id} type="button" aria-label={`Open ${agent.name}`} onClick={() => act({ type: 'open', agentId: agent.id })} className="flex w-full items-center gap-2.5 border-b border-line px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-surface-2">
                    <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2 text-[11px] font-medium text-fg-muted">{agent.avatar}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-[12.5px] font-medium">{agent.name}</span>
                        <span className="flex shrink-0 items-center gap-1 text-[10.5px] text-fg-muted"><StatusDot tone={statusTone(agent.status)} />{agent.status}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-[11.5px] text-fg-muted">{agent.model}</span>
                      {agent.task ? <span className="mt-0.5 block truncate text-[11px] text-fg-subtle">{agent.task}</span> : null}
                    </span>
                    <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                  </button>
                )) : <p className="p-4 text-[12px] text-fg-muted">Your agents will appear here when the project loads.</p>}
                {state.totalAgents > state.agents.length ? <Button variant="ghost" className="m-2" onClick={() => act({ type: 'open', view: 'agents' })}>View all {state.totalAgents} agents</Button> : null}
              </section>
            ) : (
              <section aria-label="Recent activity" className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
                {state.activity.length ? <ol className="divide-y divide-line">
                  {state.activity.map((event) => (
                    <li key={event.id} className="flex items-start gap-2.5 px-3 py-3">
                      <StatusDot tone={event.level === 'error' ? 'danger' : event.level === 'warn' ? 'warning' : event.level === 'success' ? 'success' : 'neutral'} className="mt-1.5" />
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex justify-between gap-2 text-[11px] text-fg-subtle"><span className="truncate">{event.agent || 'Agent HQ'}</span><time className="shrink-0" dateTime={new Date(event.timestamp).toISOString()}>{fmtRelative(event.timestamp)}</time></div>
                        <p className="break-words text-[12px] text-fg-muted [overflow-wrap:anywhere]">{event.text}</p>
                      </div>
                    </li>
                  ))}
                </ol> : <div className="space-y-2 px-4 py-8 text-center"><Activity aria-hidden className="mx-auto h-6 w-6 text-fg-subtle" /><p className="text-[12px] text-fg-muted">No activity yet</p><p className="text-[11.5px] text-fg-subtle">Run and review events will appear here.</p></div>}
              </section>
            )}
          </main>
        </>
      ) : (
        <main className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-[12px] text-fg-muted">
          <div className="space-y-3"><Users aria-hidden className="mx-auto h-6 w-6 text-fg-subtle" /><p role="status">{!api ? 'Open Quick status from the desktop app’s tray icon.' : failed ? 'Could not load status. Reopen this panel to try again.' : 'Loading your project…'}</p></div>
        </main>
      )}
      <footer className="flex shrink-0 items-center gap-2 border-t border-line bg-surface px-3 py-3">
        <Button variant="ghost" size="sm" disabled={!api} onClick={() => act({ type: 'quit' })}>Quit</Button>
        <span className="min-w-0 flex-1 truncate text-[11px] text-fg-subtle">v{state?.current || __APP_VERSION__}</span>
        <Button variant="primary" icon={ArrowUpRight} disabled={!api} onClick={() => act({ type: 'open' })}>Open Agent HQ</Button>
      </footer>
    </div>
  );
}
