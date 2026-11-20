import { useMemo } from 'react';
import { X } from 'lucide-react';
import { useAgentStore, formatClock, resolveAgentModel } from '@/store/useAgentStore';
import { useLayoutStore } from '@/store/useLayoutStore';
import { useConnectionsStore } from '@/store/useConnectionsStore';
import { Badge, EmptyState, IconButton, StatusDot } from '@/components/ui/primitives';
import { fmtDuration, fmtTokens, isBusy, modelLabel, statusTone } from '@/components/ui/helpers';
import { Splitter } from '@/components/ui/Splitter';
import { cn } from '@/utils/cn';

const LEVEL_TEXT = { info: 'text-fg-muted', success: 'text-success', warn: 'text-warning', error: 'text-danger' } as const;

export function ActivityPanel() {
  const activity = useAgentStore((s) => s.activity);
  const agents = useAgentStore((s) => s.agents);
  const roleDefaults = useAgentStore((s) => s.roleDefaults);
  const mission = useAgentStore((s) => s.activeMission);
  const providers = useConnectionsStore((s) => s.providers);
  const toggle = useLayoutStore((s) => s.toggle);
  const height = useLayoutStore((s) => s.activityHeight);
  const setLayout = useLayoutStore((s) => s.set);

  const busy = useMemo(() => Object.values(agents).filter((a) => isBusy(a.status) || a.status === 'waiting'), [agents]);
  const recent = useMemo(() => activity.slice(-200).reverse(), [activity]);
  const totals = useMemo(() => {
    const all = Object.values(agents);
    return {
      tokens: all.reduce((n, a) => n + a.tokenUsage.totalTokens, 0),
      calls: all.reduce((n, a) => n + a.tokenUsage.calls, 0),
    };
  }, [agents]);

  return (
    <>
      <Splitter orientation="horizontal" side="end" size={height} onResize={(v) => setLayout({ activityHeight: v })} min={120} max={480} label="Resize activity panel" />
      <section aria-label="Activity monitor" style={{ height }} className="flex shrink-0 bg-surface">
        <div className="flex w-72 shrink-0 flex-col border-r border-line">
          <div className="flex h-8 items-center justify-between gap-2 whitespace-nowrap border-b border-line px-3">
            <span className="min-w-0 truncate text-[12px] font-semibold">Active agents</span>
            <span className="min-w-0 truncate text-[11px] text-fg-subtle">{fmtTokens(totals.tokens)} tokens · {totals.calls} calls</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {busy.length === 0 ? (
              <p className="p-3 text-[12px] text-fg-subtle">No agents are running.{mission?.status === 'completed' ? ' Last run completed.' : ''}</p>
            ) : (
              busy.map((a) => (
                <div key={a.id} className="border-b border-line px-3 py-2">
                  <div className="flex items-center gap-2">
                    <StatusDot tone={statusTone(a.status)} pulse={isBusy(a.status)} />
                    <span className="min-w-0 truncate font-medium">{a.name}</span>
                    <Badge className="shrink-0">{a.status}</Badge>
                  </div>
                  {a.currentTask ? <p className="mt-0.5 truncate text-[12px] text-fg-muted">{a.currentTask}</p> : null}
                  <p className="mt-0.5 truncate font-mono text-[11px] text-fg-subtle">{modelLabel(providers, resolveAgentModel(a, roleDefaults)) || 'no model'}</p>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-8 items-center justify-between gap-2 whitespace-nowrap border-b border-line px-3">
            <span className="min-w-0 truncate text-[12px] font-semibold">Events <span className="font-normal text-fg-subtle">({activity.length})</span></span>
            <IconButton icon={X} label="Close activity panel" size="sm" onClick={() => toggle('activityOpen')} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto font-mono text-[11.5px]">
            {recent.length === 0 ? (
              <EmptyState title="No activity yet">Events from real runs appear here as they happen.</EmptyState>
            ) : (
              recent.map((e) => (
                <div key={e.id} className="log-row flex gap-2 px-3 py-0.5 hover:bg-surface-2">
                  <span className="shrink-0 text-fg-subtle">{formatClock(e.timestamp)}</span>
                  <span className="w-20 shrink-0 truncate text-fg-muted">{e.agentId ? agents[e.agentId]?.name ?? e.agentId : e.kind}</span>
                  <span className={cn('min-w-0 flex-1 break-words', LEVEL_TEXT[e.level])}>{e.text}</span>
                  {e.tokens ? <span className="shrink-0 text-fg-subtle">{fmtTokens(e.tokens)} tok</span> : null}
                  {e.durationMs ? <span className="shrink-0 text-fg-subtle">{fmtDuration(e.durationMs)}</span> : null}
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </>
  );
}
