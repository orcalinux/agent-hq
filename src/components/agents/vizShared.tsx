import { useEffect, useRef, useState } from 'react';
import { useAgentStore } from '@/store/useAgentStore';
import type { AgentProfile } from '@/types';
import { Badge } from '@/components/ui/primitives';
import { isBusy, statusTone } from '@/components/ui/helpers';
import { cn } from '@/utils/cn';
import { FlowFeed, FlowLegend } from './FlowLayer';
import type { AgentFlow } from './flows';

export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((s) => (Math.abs(s.width - width) < 1 && Math.abs(s.height - height) < 1 ? s : { width, height }));
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);
  return [ref, size] as const;
}

const RING: Record<string, string> = {
  accent: 'var(--accent)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  neutral: 'var(--line-strong)',
};

export function AgentAvatar({ agent, size = 32, className }: { agent: AgentProfile; size?: number; className?: string }) {
  const tone = statusTone(agent.status);
  return (
    <span
      aria-hidden
      className={cn('relative inline-flex shrink-0 items-center justify-center rounded-full font-semibold', isBusy(agent.status) && 'ahq-busy', className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.34),
        color: agent.accentColor,
        background: 'color-mix(in srgb, ' + agent.accentColor + ' 16%, var(--surface))',
        border: '2px solid ' + RING[tone],
        ['--ring' as string]: RING[tone],
      }}
    >
      {agent.avatar}
    </span>
  );
}

export function ProgressLine({ value }: { value: number }) {
  return (
    <span className="block h-1 w-full overflow-hidden rounded-full bg-surface-3">
      <span className="block h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: Math.max(0, Math.min(100, value)) + '%' }} />
    </span>
  );
}

/** Right-hand panel shared by Graph and Office: run summary, legend and the live message feed. */
export function VizSidebar({ flows }: { flows: AgentFlow[] }) {
  const mission = useAgentStore((s) => s.activeMission);
  const agents = useAgentStore((s) => s.agents);
  const list = Object.values(agents);
  const busy = list.filter((a) => isBusy(a.status) || a.status === 'waiting');
  const done = mission?.tasks.filter((t) => t.status === 'completed').length ?? 0;
  const total = mission?.tasks.length ?? 0;
  const nameOf = (id: string) => agents[id]?.name ?? id;
  return (
    <aside className="flex w-full shrink-0 flex-col gap-3 overflow-y-auto border-t border-line bg-canvas p-3 lg:w-80 lg:border-l lg:border-t-0">
      <section className="rounded-xl border border-line bg-surface p-3 shadow-card">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h3 className="truncate text-[12px] font-semibold">Current run</h3>
          {mission ? <Badge tone={mission.source === 'simulation' ? 'warning' : 'accent'}>{mission.source === 'simulation' ? 'demo' : 'live'} · {mission.status}</Badge> : null}
        </div>
        {mission ? (
          <>
            <p className="mb-2 truncate text-[12.5px] text-fg-muted">{mission.title}</p>
            <div className="mb-1 flex justify-between gap-2 text-[11.5px] text-fg-subtle">
              <span className="min-w-0 truncate">{mission.currentStage}</span>
              <span className="shrink-0 whitespace-nowrap">{done}/{total} tasks</span>
            </div>
            <ProgressLine value={total ? (done / total) * 100 : 0} />
          </>
        ) : (
          <p className="text-[12px] text-fg-muted">No run yet. Give Sovereign a task in the Workspace (Plan → Approve) and watch agents work here.</p>
        )}
      </section>
      <section className="rounded-md border border-line bg-surface p-3">
        <h3 className="mb-2 text-[12px] font-semibold">Working now <span className="font-normal text-fg-subtle">({busy.length})</span></h3>
        {busy.length === 0 ? (
          <p className="text-[12px] text-fg-muted">All agents idle.</p>
        ) : (
          <ul className="space-y-2">
            {busy.map((a) => (
              <li key={a.id} className="flex items-center gap-2">
                <AgentAvatar agent={a} size={24} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium">{a.name} <span className="font-normal text-fg-subtle">· {a.status}</span></span>
                  <span className="block truncate text-[11.5px] text-fg-muted">{a.currentTask ?? '—'}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <FlowFeed flows={flows} nameOf={nameOf} />
      <section className="rounded-md border border-line bg-surface p-3">
        <h3 className="mb-2 text-[12px] font-semibold">Legend</h3>
        <FlowLegend className="flex-col items-start" />
      </section>
    </aside>
  );
}
