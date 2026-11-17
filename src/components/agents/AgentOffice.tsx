import { useMemo } from 'react';
import { useAgentStore } from '@/store/useAgentStore';
import type { AgentProfile, RoomLocation } from '@/types';
import { isBusy } from '@/components/ui/helpers';
import { cn } from '@/utils/cn';
import { FlowLayer } from './FlowLayer';
import { useAgentFlows, useRecentAgentMessages, useReducedMotion } from './flows';
import { AgentAvatar, VizSidebar, useElementSize } from './vizShared';

const PLAN_W = 1000;
const PLAN_H = 640;
const MIN_W = 640;
const MIN_H = 420;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface RoomSpec {
  id: RoomLocation;
  purpose: string;
  color: string;
  rect: Rect;
  door: Rect;
}

const ROOMS: RoomSpec[] = [
  { id: 'Executive Suite', purpose: 'Planning & delegation', color: '#D97706', rect: { x: 300, y: 16, w: 400, h: 170 }, door: { x: 480, y: 181, w: 40, h: 10 } },
  { id: 'Architecture Lab', purpose: 'Design & contracts', color: '#7C3AED', rect: { x: 16, y: 216, w: 264, h: 220 }, door: { x: 275, y: 296, w: 10, h: 40 } },
  { id: 'Dev Bay', purpose: 'Implementation', color: '#2563EB', rect: { x: 300, y: 216, w: 400, h: 220 }, door: { x: 480, y: 211, w: 40, h: 10 } },
  { id: 'QA Vault', purpose: 'Review, tests & security', color: '#059669', rect: { x: 720, y: 216, w: 264, h: 220 }, door: { x: 715, y: 296, w: 10, h: 40 } },
  { id: 'Incubator Pod', purpose: 'Juniors with N+1 mentors', color: '#DB2777', rect: { x: 300, y: 466, w: 400, h: 158 }, door: { x: 480, y: 461, w: 40, h: 10 } },
];

const WOOD = 'color-mix(in srgb, #b4824a 60%, var(--surface-3))';

function Plant({ x, y }: { x: number; y: number }) {
  return (
    <g transform={'translate(' + x + ' ' + y + ')'}>
      <circle r={11} style={{ fill: 'color-mix(in srgb, #16a34a 55%, var(--surface-3))' }} />
      <circle r={6} cx={-2} cy={-1} style={{ fill: 'color-mix(in srgb, #16a34a 80%, var(--surface-3))' }} />
      <circle r={3} cx={2} cy={2} style={{ fill: 'color-mix(in srgb, #16a34a 95%, var(--surface-3))' }} />
    </g>
  );
}

function Desk({ x, y, busy }: { x: number; y: number; busy: boolean }) {
  return (
    <g transform={'translate(' + x + ' ' + y + ')'}>
      <circle r={20} cy={4} className="fill-surface-3 stroke-line-strong" strokeWidth={1.5} />
      <rect x={-48} y={-46} width={96} height={30} rx={5} style={{ fill: WOOD }} className="stroke-line-strong" strokeWidth={1.5} />
      <rect x={-15} y={-43} width={30} height={16} rx={2.5} className="stroke-line-strong" strokeWidth={1} style={{ fill: busy ? 'var(--accent)' : 'var(--canvas)', opacity: busy ? 0.9 : 1 }} />
      <rect x={-12} y={-24} width={24} height={5} rx={1.5} className="fill-surface-3 stroke-line-strong" strokeWidth={0.75} />
      <circle cx={36} cy={-31} r={4} className="fill-surface stroke-line-strong" strokeWidth={1} />
      <rect x={-40} y={-39} width={14} height={10} rx={1.5} className="fill-surface" opacity={0.85} />
    </g>
  );
}

function Furniture({ room }: { room: RoomSpec }) {
  const r = room.rect;
  switch (room.id) {
    case 'Executive Suite':
      return (
        <g>
          <rect x={r.x + 262} y={r.y + 38} width={96} height={44} rx={22} style={{ fill: WOOD }} className="stroke-line-strong" strokeWidth={1.5} />
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <circle cx={r.x + 286 + i * 24} cy={r.y + 28} r={7} className="fill-surface-3 stroke-line-strong" />
              <circle cx={r.x + 286 + i * 24} cy={r.y + 92} r={7} className="fill-surface-3 stroke-line-strong" />
            </g>
          ))}
          <rect x={r.x + 14} y={r.y + r.h - 22} width={90} height={10} rx={2} style={{ fill: WOOD }} className="stroke-line-strong" />
          <Plant x={r.x + r.w - 20} y={r.y + r.h - 20} />
        </g>
      );
    case 'Architecture Lab':
      return (
        <g>
          <rect x={r.x + 6} y={r.y + 70} width={7} height={96} rx={2} className="fill-surface stroke-line-strong" />
          <path d={'M' + (r.x + 8) + ' ' + (r.y + 84) + 'h3M' + (r.x + 8) + ' ' + (r.y + 100) + 'h3M' + (r.x + 8) + ' ' + (r.y + 118) + 'h3'} stroke={room.color} strokeWidth={2} strokeLinecap="round" />
          <Plant x={r.x + r.w - 20} y={r.y + r.h - 20} />
        </g>
      );
    case 'Dev Bay':
      return (
        <g>
          <Plant x={r.x + 20} y={r.y + r.h - 20} />
          <Plant x={r.x + r.w - 20} y={r.y + r.h - 20} />
        </g>
      );
    case 'QA Vault':
      return (
        <g>
          {[0, 1, 2].map((i) => (
            <g key={i} transform={'translate(' + (r.x + r.w - 94 + i * 28) + ' ' + (r.y + 38) + ')'}>
              <rect width={22} height={44} rx={3} className="fill-surface-3 stroke-line-strong" />
              {[0, 1, 2, 3].map((j) => <circle key={j} cx={6} cy={8 + j * 9} r={1.6} style={{ fill: j % 2 ? 'var(--success)' : 'var(--line-strong)' }} />)}
            </g>
          ))}
          <Plant x={r.x + 20} y={r.y + r.h - 20} />
        </g>
      );
    default:
      return (
        <g>
          <rect x={r.x + r.w - 118} y={r.y + 44} width={100} height={30} rx={9} style={{ fill: 'color-mix(in srgb, ' + room.color + ' 35%, var(--surface-3))' }} className="stroke-line-strong" />
          <rect x={r.x + r.w - 114} y={r.y + 40} width={92} height={9} rx={4.5} style={{ fill: 'color-mix(in srgb, ' + room.color + ' 50%, var(--surface-3))' }} />
          <Plant x={r.x + 20} y={r.y + r.h - 18} />
        </g>
      );
  }
}

export function AgentOffice() {
  const agents = useAgentStore((s) => s.agents);
  const selectedId = useAgentStore((s) => s.selectedAgentId);
  const select = useAgentStore((s) => s.selectAgent);
  const flows = useAgentFlows();
  const messages = useRecentAgentMessages();
  const reduced = useReducedMotion();
  const [ref, size] = useElementSize<HTMLDivElement>();
  const width = Math.max(size.width, MIN_W);
  const height = Math.max(size.height, MIN_H);
  const scale = Math.min(width / PLAN_W, height / PLAN_H);
  const ox = (width - PLAN_W * scale) / 2;
  const oy = (height - PLAN_H * scale) / 2;
  const avatarSize = Math.round(Math.max(28, Math.min(44, 38 * scale)));

  const { byRoom, seat } = useMemo(() => {
    const groups = new Map<RoomLocation, AgentProfile[]>();
    Object.values(agents).forEach((a) => {
      const room = ROOMS.some((r) => r.id === a.roomLocation) ? a.roomLocation : 'Dev Bay';
      groups.set(room, [...(groups.get(room) ?? []), a]);
    });
    const seats = new Map<string, { x: number; y: number }>();
    ROOMS.forEach((room) => {
      const members = groups.get(room.id) ?? [];
      const perRow = Math.max(1, Math.min(members.length, 4));
      const rows = Math.ceil(members.length / perRow);
      members.forEach((a, i) => {
        const row = Math.floor(i / perRow);
        const col = i % perRow;
        const inRow = Math.min(perRow, members.length - row * perRow);
        seats.set(a.id, {
          x: room.rect.x + (room.rect.w * (col + 1)) / (inRow + 1),
          y: room.rect.y + 48 + ((room.rect.h - 48) * (row + 0.55)) / rows,
        });
      });
    });
    return { byRoom: groups, seat: seats };
  }, [agents]);

  const px = (p: { x: number; y: number }) => ({ x: ox + p.x * scale, y: oy + p.y * scale });
  const pointOf = (id: string) => {
    const s = seat.get(id);
    return s ? px(s) : undefined;
  };

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <div ref={ref} className="relative min-h-[420px] min-w-0 flex-1 overflow-auto bg-canvas">
        <div className="relative" style={{ width, height }}>
          <svg width={width} height={height} className="pointer-events-none absolute inset-0" role="img" aria-label="Office floor plan">
            <g transform={'translate(' + ox + ' ' + oy + ') scale(' + scale + ')'}>
              <rect x={4} y={4} width={PLAN_W - 8} height={PLAN_H - 8} rx={14} className="fill-surface-2 stroke-line-strong" strokeWidth={6} />
              <rect x={10} y={10} width={PLAN_W - 20} height={PLAN_H - 20} rx={10} fill="url(#ahq-carpet)" opacity={0.6} />
              <defs>
                <pattern id="ahq-carpet" width="14" height="14" patternUnits="userSpaceOnUse">
                  <path d="M0 0h14v14H0z" fill="none" />
                  <path d="M0 7h14M7 0v14" className="stroke-line" strokeWidth={0.6} />
                </pattern>
              </defs>
              {ROOMS.map((room) => {
                const working = (byRoom.get(room.id) ?? []).some((a) => isBusy(a.status));
                return (
                  <g key={room.id}>
                    <rect
                      x={room.rect.x}
                      y={room.rect.y}
                      width={room.rect.w}
                      height={room.rect.h}
                      rx={6}
                      strokeWidth={working ? 4 : 3}
                      style={{
                        fill: 'color-mix(in srgb, ' + room.color + ' 8%, var(--surface))',
                        stroke: working ? 'color-mix(in srgb, ' + room.color + ' 70%, var(--line-strong))' : 'var(--line-strong)',
                      }}
                    />
                    <rect x={room.door.x} y={room.door.y} width={room.door.w} height={room.door.h} rx={2} style={{ fill: 'var(--surface-2)' }} />
                    <Furniture room={room} />
                  </g>
                );
              })}
              {Object.values(agents).map((agent) => {
                const s = seat.get(agent.id);
                return s ? <Desk key={agent.id} x={s.x} y={s.y} busy={isBusy(agent.status)} /> : null;
              })}
            </g>
          </svg>
          {ROOMS.map((room) => {
            const members = byRoom.get(room.id) ?? [];
            const working = members.filter((a) => isBusy(a.status)).length;
            const p = px(room.rect);
            return (
              <header key={room.id} aria-label={room.id} className="pointer-events-none absolute flex items-start justify-between gap-2 px-3 pt-2" style={{ left: p.x, top: p.y, width: room.rect.w * scale }}>
                <div className="min-w-0">
                  <h3 className="flex items-center gap-1.5 truncate text-[12.5px] font-semibold">
                    <span className="inline-block h-2 w-2 rounded-sm" style={{ background: room.color }} />
                    {room.id}
                  </h3>
                  <p className="truncate text-[11px] text-fg-subtle">{room.purpose}</p>
                </div>
                <span className="shrink-0 text-[11px] text-fg-subtle">{working > 0 ? working + ' working' : members.length ? 'quiet' : 'empty'}</span>
              </header>
            );
          })}
          <svg width={width} height={height} className="pointer-events-none absolute inset-0" aria-hidden>
            <FlowLayer flows={flows} pointOf={pointOf} reducedMotion={reduced} />
          </svg>
          {Object.values(agents).map((agent) => {
            const s = seat.get(agent.id);
            if (!s) return null;
            const p = px(s);
            const bubble = messages[agent.id];
            return (
              <div key={agent.id} className="absolute" style={{ left: p.x, top: p.y, transform: 'translate(-50%, -50%)' }}>
                {bubble ? (
                  <div
                    role="status"
                    className="ahq-bubble absolute bottom-full left-1/2 z-10 mb-1 w-max max-w-[150px] rounded-md border border-line-strong bg-surface-2 px-2 py-1 text-[11px] leading-snug text-fg shadow-md"
                    style={{ transform: 'translateX(-50%)', marginBottom: 48 * scale }}
                  >
                    <span className="line-clamp-2">{bubble}</span>
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => select(agent.id === selectedId ? null : agent.id)}
                  aria-pressed={selectedId === agent.id}
                  aria-label={agent.name + ', ' + agent.title + ', ' + agent.status}
                  className={cn('relative flex flex-col items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent', selectedId === agent.id && 'ring-2 ring-accent/50')}
                >
                  <AgentAvatar agent={agent} size={avatarSize} />
                  <span className="pointer-events-none absolute left-1/2 top-full mt-1 flex w-[112px] -translate-x-1/2 flex-col items-center">
                    <span className="text-[12px] font-semibold leading-none">{agent.name}</span>
                    <span className={cn('mt-0.5 w-full truncate text-center text-[10.5px] leading-tight', agent.currentTask ? 'text-fg-muted' : 'text-fg-subtle')} title={agent.currentTask}>
                      {agent.currentTask ?? agent.status}
                    </span>
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
      {selectedId ? null : <VizSidebar flows={flows} />}
    </div>
  );
}
