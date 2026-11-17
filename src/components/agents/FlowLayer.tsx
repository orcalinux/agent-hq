import type { AgentFlow, FlowKind } from './flows';
import { FLOW_META, curvePath } from './flows';
import { cn } from '@/utils/cn';

interface Point {
  x: number;
  y: number;
}

export function FlowLayer({ flows, pointOf, reducedMotion }: { flows: AgentFlow[]; pointOf: (agentId: string) => Point | undefined; reducedMotion: boolean }) {
  return (
    <g>
      {flows.map((f, i) => {
        const a = pointOf(f.from);
        const b = pointOf(f.to);
        if (!a || !b) return null;
        const d = curvePath(a.x, a.y, b.x, b.y);
        const color = FLOW_META[f.kind].color;
        return (
          <g key={f.id} style={{ opacity: i === 0 ? 1 : 0.75 }}>
            <path d={d} fill="none" stroke={color} strokeWidth={6} opacity={0.12} />
            <path d={d} fill="none" stroke={color} strokeWidth={1.75} className={reducedMotion ? undefined : 'ahq-flow-line'} />
            {reducedMotion ? null : (
              <circle r={4} fill={color}>
                <animateMotion dur="1.6s" repeatCount="indefinite" path={d} />
              </circle>
            )}
            <title>{f.label}</title>
          </g>
        );
      })}
    </g>
  );
}

export function FlowLegend({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-fg-muted', className)}>
      {(Object.keys(FLOW_META) as FlowKind[]).map((k) => (
        <span key={k} className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: FLOW_META[k].color }} />
          {FLOW_META[k].label}
        </span>
      ))}
    </div>
  );
}

export function FlowFeed({ flows, nameOf }: { flows: AgentFlow[]; nameOf: (id: string) => string }) {
  return (
    <div className="rounded-md border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <h3 className="text-[12px] font-semibold">Live communication</h3>
        <span className="text-[11px] text-fg-subtle">From engine events</span>
      </div>
      {flows.length === 0 ? (
        <p className="px-3 py-2.5 text-[12px] text-fg-muted">Quiet right now. Messages appear here as Sovereign delegates, agents hand off work, mentors review and QA reports.</p>
      ) : (
        <ul className="max-h-40 overflow-auto py-1">
          {flows.map((f) => (
            <li key={f.id} className="flex items-center gap-2 px-3 py-1 text-[12px]">
              <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: FLOW_META[f.kind].color }} />
              <span className="shrink-0 font-medium">{nameOf(f.from)}</span>
              <span className="shrink-0 text-fg-subtle">→</span>
              <span className="shrink-0 font-medium">{nameOf(f.to)}</span>
              <span className="min-w-0 truncate text-fg-muted">{f.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
