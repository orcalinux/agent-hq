import { useMemo, useRef, useState } from 'react';
import { useAgentStore, resolveAgentModel } from '@/store/useAgentStore';
import { useConnectionsStore } from '@/store/useConnectionsStore';
import { useLayoutStore } from '@/store/useLayoutStore';
import type { AgentProfile, AgentRole } from '@/types';
import { modelLabel } from '@/components/ui/helpers';
import { cn } from '@/utils/cn';
import { FlowLayer } from './FlowLayer';
import { PanZoom } from './PanZoom';
import { useAgentFlows, useReducedMotion } from './flows';
import { AgentAvatar, ProgressLine, VizSidebar, useElementSize } from './vizShared';

const ROW_OF: Record<AgentRole, number> = { manager: 0, architect: 1, frontend: 2, backend: 2, qa: 2, intern: 3 };
const NODE_H = 96;
const MIN_H = 560;

interface Placed {
  agent: AgentProfile;
  cx: number;
  cy: number;
}

function edge(a: Placed, b: Placed): string {
  const y1 = a.cy + NODE_H / 2;
  const y2 = b.cy - NODE_H / 2;
  const mid = (y1 + y2) / 2;
  return 'M' + a.cx + ',' + y1 + ' C' + a.cx + ',' + mid + ' ' + b.cx + ',' + mid + ' ' + b.cx + ',' + y2;
}

export function AgentGraph() {
  const agents = useAgentStore((s) => s.agents);
  const roleDefaults = useAgentStore((s) => s.roleDefaults);
  const mission = useAgentStore((s) => s.activeMission);
  const selectedId = useAgentStore((s) => s.selectedAgentId);
  const select = useAgentStore((s) => s.selectAgent);
  const providers = useConnectionsStore((s) => s.providers);
  const flows = useAgentFlows();
  const reduced = useReducedMotion();
  const [ref, size] = useElementSize<HTMLDivElement>();
  const offsets = useLayoutStore((s) => s.graphPositions);
  const setLayout = useLayoutStore((s) => s.set);
  const [live, setLive] = useState<{ id: string; x: number; y: number } | null>(null);
  const gesture = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const width = Math.max(size.width, 360);
  const height = Math.max(size.height, MIN_H);

  const { placed, nodeW, delegation, mentorship, dependencies } = useMemo(() => {
    const rows: AgentProfile[][] = [[], [], [], []];
    Object.values(agents).forEach((a) => rows[ROW_OF[a.role] ?? 2].push(a));
    const used = rows.filter((r) => r.length > 0);
    const widest = Math.max(1, ...used.map((r) => r.length));
    const w = Math.max(120, Math.min(250, width / (widest + 1) - 12));
    const top = 28 + NODE_H / 2;
    const step = used.length > 1 ? (height - 28 * 2 - NODE_H) / (used.length - 1) : 0;
    const map = new Map<string, Placed>();
    used.forEach((row, ri) => {
      row.forEach((agent, i) => {
        const moved = live?.id === agent.id ? live : offsets[agent.id];
        map.set(agent.id, { agent, cx: (width * (i + 1)) / (row.length + 1) + (moved?.x ?? 0), cy: top + ri * step + (moved?.y ?? 0) });
      });
    });
    const get = (id: string | undefined) => (id ? map.get(id) : undefined);
    const all = Object.values(agents);
    const sovereign = all.find((a) => a.role === 'manager');
    const architect = all.find((a) => a.role === 'architect');
    const deleg: Array<[Placed, Placed]> = [];
    const ment: Array<[Placed, Placed]> = [];
    all.forEach((a) => {
      const self = get(a.id)!;
      if (a.internship?.isIntern) {
        const mentor = get(a.internship.mentorId);
        if (mentor) ment.push([mentor, self]);
        return;
      }
      const parent = a.role === 'architect' || a.role === 'qa' ? get(sovereign?.id) : ['frontend', 'backend'].includes(a.role) ? get((architect ?? sovereign)?.id) : undefined;
      if (parent && parent !== self) deleg.push([parent, self]);
    });
    const deps = new Map<string, { from: Placed; to: Placed; label: string }>();
    mission?.tasks.forEach((t) => {
      t.dependsOn?.forEach((depId) => {
        const dep = mission.tasks.find((x) => x.id === depId);
        const from = get(dep?.assignedAgentId);
        const to = get(t.assignedAgentId);
        if (from && to && from !== to) deps.set(from.agent.id + '>' + to.agent.id, { from, to, label: (dep?.title ?? depId) + ' → ' + t.title });
      });
    });
    return { placed: [...map.values()], nodeW: w, delegation: deleg, mentorship: ment, dependencies: [...deps.values()] };
  }, [agents, mission, width, height, offsets, live]);

  const pointOf = (id: string) => {
    const p = placed.find((x) => x.agent.id === id);
    return p ? { x: p.cx, y: p.cy } : undefined;
  };

  const startDrag = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return;
    const base = offsets[id] ?? { x: 0, y: 0 };
    gesture.current = { id, sx: e.clientX, sy: e.clientY, ox: base.x, oy: base.y, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const moveDrag = (e: React.PointerEvent, zoom: number) => {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.sx;
    const dy = e.clientY - g.sy;
    if (!g.moved && Math.hypot(dx, dy) < 4) return;
    g.moved = true;
    setLive({ id: g.id, x: g.ox + dx / zoom, y: g.oy + dy / zoom });
  };

  const endDrag = (e: React.PointerEvent, id: string) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.moved && live) setLayout({ graphPositions: { ...offsets, [id]: { x: live.x, y: live.y } } });
    else select(id === selectedId ? null : id);
    setLive(null);
    if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  };

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <div ref={ref} className="relative min-h-[420px] min-w-0 flex-1 bg-canvas">
        <PanZoom contentWidth={width} contentHeight={height} onResetLayout={() => setLayout({ graphPositions: {} })} resetLayoutLabel="Reset node positions">
          {(view) => (
        <div className="relative" style={{ width, height }}>
          <svg width={width} height={height} className="pointer-events-none absolute inset-0 overflow-visible" aria-hidden>
            {delegation.map(([a, b]) => <path key={'d' + a.agent.id + b.agent.id} d={edge(a, b)} fill="none" className="stroke-line-strong" strokeWidth={1.5} />)}
            {mentorship.map(([a, b]) => <path key={'m' + a.agent.id + b.agent.id} d={edge(a, b)} fill="none" className="stroke-fg-subtle" strokeWidth={1.25} strokeDasharray="4 4" />)}
            {dependencies.map((d) => (
              <path key={'x' + d.from.agent.id + d.to.agent.id} d={'M' + d.from.cx + ',' + d.from.cy + ' L' + d.to.cx + ',' + d.to.cy} fill="none" stroke="var(--tok-type)" strokeWidth={1.25} strokeDasharray="2 4" opacity={0.7}>
                <title>{d.label}</title>
              </path>
            ))}
            <FlowLayer flows={flows} pointOf={pointOf} reducedMotion={reduced} />
          </svg>
          {placed.map(({ agent, cx, cy }) => {
            const model = resolveAgentModel(agent, roleDefaults);
            const active = flows.some((f) => f.from === agent.id || f.to === agent.id);
            return (
              <button
                key={agent.id}
                type="button"
                data-no-pan
                onPointerDown={(e) => startDrag(e, agent.id)}
                onPointerMove={(e) => moveDrag(e, view.zoom)}
                onPointerUp={(e) => endDrag(e, agent.id)}
                onPointerCancel={() => {
                  gesture.current = null;
                  setLive(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    select(agent.id === selectedId ? null : agent.id);
                  }
                }}
                aria-pressed={selectedId === agent.id}
                style={{ left: cx - nodeW / 2, top: cy - NODE_H / 2, width: nodeW, height: NODE_H }}
                className={cn(
                  'absolute flex cursor-grab touch-none select-none flex-col gap-1 rounded-lg border bg-surface px-3 py-2 text-left shadow-sm transition-[border-color,box-shadow,background-color] duration-200 hover:bg-surface-2 active:cursor-grabbing',
                  selectedId === agent.id ? 'border-accent ring-2 ring-accent/25' : active ? 'border-accent/60' : 'border-line-strong'
                )}
              >
                <span className="flex items-center gap-2">
                  <AgentAvatar agent={agent} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-semibold">{agent.name}</span>
                      <span className="ml-auto shrink-0 text-[10.5px] uppercase tracking-wide text-fg-subtle">{agent.status}</span>
                    </span>
                    <span className="block truncate text-[11.5px] text-fg-muted">{agent.title}</span>
                  </span>
                </span>
                <span className={cn('block truncate font-mono text-[10.5px]', model ? 'text-fg-subtle' : 'text-warning')}>{model ? modelLabel(providers, model) : 'no model assigned'}</span>
                {agent.currentTask ? (
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[11px] text-fg-muted" title={agent.currentTask}>{agent.currentTask}</span>
                    <span className="w-10 shrink-0"><ProgressLine value={agent.taskProgress} /></span>
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
          )}
        </PanZoom>
      </div>
      {selectedId ? null : <VizSidebar flows={flows} />}
    </div>
  );
}
