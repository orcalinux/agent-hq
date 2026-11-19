import { memo, useMemo, useState } from 'react';
import { Moon, Sun, SunMoon } from 'lucide-react';
import { useAgentStore } from '@/store/useAgentStore';
import type { AgentProfile } from '@/types';
import { isBusy, statusTone, type Tone } from '@/components/ui/helpers';
import { cn } from '@/utils/cn';
import { FlowLayer } from './FlowLayer';
import { PanZoom } from './PanZoom';
import { useAgentFlows, useRecentAgentMessages, useReducedMotion } from './flows';
import { AgentAvatar, VizSidebar } from './vizShared';
import { DOORS, GLASS, INNER, PLAN_H, PLAN_W, ROOMS, WINDOWS, assignSeats, lightsFor, type RoomId, type Slot } from './office/officePlan';
import {
  BeanBag,
  Bookshelf,
  BreakRoomFixtures,
  Camera,
  Chair,
  ConferenceTable,
  Desk,
  DoorSwing,
  DraftingTable,
  Extinguisher,
  Laptop,
  OfficeDefs,
  Plant,
  Printer,
  RoundTable,
  Rug,
  ServerRack,
  Sofa,
  StandingDesk,
  Stairs,
  TestBench,
  Whiteboard,
  WindowPane,
  deskDepth,
} from './office/officeArt';

const WALL = '#3b4048';
const MINI_W = 168;
const MINI_H = Math.round((168 * PLAN_H) / PLAN_W);
const CORRIDOR = { x: 32, y: 262, w: 1136, h: 72 };
const STATUS_DOT: Record<Tone, string> = { accent: '#5b9bff', success: '#22c55e', warning: '#f59e0b', danger: '#ef4444', neutral: '#9ca3af' };
type LightMode = 'auto' | 'day' | 'night';

const Scenery = memo(function Scenery({ night }: { night: boolean }) {
  return (
    <g>
      <rect width={PLAN_W} height={PLAN_H} rx={16} fill={night ? '#141920' : '#c4c7bf'} />
      <rect x={0} y={282} width={24} height={32} fill={night ? '#232934' : '#dbd8d0'} />
      <rect x={INNER.x} y={INNER.y} width={INNER.w} height={INNER.h} fill="url(#ahq-f-tile)" />
      {ROOMS.map((r) => <rect key={r.id} x={r.rect.x} y={r.rect.y} width={r.rect.w} height={r.rect.h} fill={`url(#${r.floor})`} />)}
      <rect x={INNER.x} y={INNER.y} width={INNER.w} height={INNER.h} filter="url(#ahq-grain)" opacity={0.5} style={{ mixBlendMode: 'multiply' }} />
      {night ? null : (
        <g>
          <rect x={INNER.x} y={INNER.y} width={INNER.w} height={120} fill="url(#ahq-sun-down)" />
          <rect x={INNER.x} y={INNER.y} width={110} height={INNER.h} fill="url(#ahq-sun-right)" />
          <rect x={INNER.x} y={628} width={INNER.w} height={100} fill="url(#ahq-sun-up)" />
        </g>
      )}

      <Rug x={70} y={287} w={1010} h={22} fill="#5a4a3d" border="#8a7358" />
      <rect x={34} y={282} width={22} height={32} rx={2} fill="#2f2f2f" />
      <Stairs x={1100} y={266} w={66} h={64} />
      <Plant x={1084} y={277} s={0.75} />
      <Plant x={1084} y={319} s={0.75} />

      <Bookshelf x={44} y={36} w={192} />
      <Rug x={48} y={180} w={184} h={74} fill="#6b2f2f" border="#c9a26b" />
      <Sofa x={52} y={222} w={150} rot={180} frame="#3a2e2a" back="#4a3a34" seat="#5a4840" />
      <g filter="url(#ahq-sh)">
        <rect x={96} y={186} width={56} height={24} rx={3} fill="url(#ahq-walnut)" />
      </g>
      <Plant x={110} y={198} s={0.42} />
      <ConferenceTable cx={312} cy={122} rx={58} ry={30} />
      <rect x={402} y={94} width={5} height={56} rx={1} fill="#111" />
      <Plant x={392} y={52} />
      <Plant x={390} y={240} s={0.9} />

      <Bookshelf x={430} y={36} w={100} />
      <Whiteboard x={540} y={38} len={96} />
      <DraftingTable x={648} y={50} />
      <BeanBag x={696} y={198} color="#7c5cbf" />
      <BeanBag x={662} y={216} color="#c2683b" />
      <Plant x={726} y={244} s={0.9} />
      <Plant x={430} y={244} s={0.8} />

      {[44, 82, 120, 158, 196].map((y, i) => <ServerRack key={y} x={1104} y={y} seed={i} />)}
      <TestBench x={862} y={210} w={190} h={40} />
      <Camera x={752} y={42} rot={45} />
      <Extinguisher x={1090} y={250} />
      <Plant x={762} y={246} s={0.8} />

      <Printer x={600} y={348} />
      <StandingDesk x={556} y={450} />
      <Whiteboard x={652} y={410} len={110} vertical />
      <Rug x={48} y={624} w={250} h={92} fill="#2f4858" border="#9fb7c4" />
      <Sofa x={60} y={688} w={160} rot={180} />
      <Sofa x={236} y={640} w={44} h={40} rot={90} frame="#5b4636" back="#6e5643" seat="#86694f" pillow="#e2e8f0" />
      <g filter="url(#ahq-sh)">
        <rect x={100} y={646} width={70} height={26} rx={13} fill="url(#ahq-oak)" />
      </g>
      <Laptop x={124} y={659} rot={6} />
      <Plant x={52} y={352} s={0.9} />
      <Plant x={290} y={352} s={0.8} />
      <Plant x={650} y={712} s={0.9} />

      <Bookshelf x={1162} y={380} w={150} rot={90} />
      <BreakRoomFixtures night={night} />

      {ROOMS.map((r) => <rect key={r.id} x={r.rect.x} y={r.rect.y} width={r.rect.w} height={r.rect.h} fill="none" stroke={WALL} strokeWidth={8} />)}
      <rect x={26} y={26} width={1148} height={708} rx={4} fill="none" stroke={WALL} strokeWidth={12} />
      {GLASS.map(([x1, y1, x2, y2]) => (
        <g key={x1}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={night ? '#3c5a70' : '#d3ecf8'} strokeWidth={4.5} />
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#59606a" strokeWidth={4.5} strokeDasharray="2 46" />
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#7fb6d6" strokeWidth={0.8} />
        </g>
      ))}
      {WINDOWS.map((w) => <WindowPane key={w.x + '-' + w.y} r={w} night={night} />)}
      {DOORS.map((d) => <DoorSwing key={d.x + '-' + d.y} door={d} />)}
    </g>
  );
});

function OptionalDecor({ devRow, incubatorRow }: { devRow: boolean; incubatorRow: boolean }) {
  return (
    <g>
      {devRow ? null : (
        <g>
          {[392, 452, 512, 566].map((x) => <Chair key={'t' + x} x={x} y={640} rot={180} color="#6b7280" back="#4b5563" />)}
          {[392, 452, 512, 566].map((x) => <Chair key={'b' + x} x={x} y={694} color="#6b7280" back="#4b5563" />)}
          <g filter="url(#ahq-sh)">
            <rect x={364} y={654} width={232} height={28} rx={3} fill="url(#ahq-oak)" />
          </g>
          <Laptop x={420} y={668} rot={4} />
          <Laptop x={530} y={668} rot={176} />
        </g>
      )}
      {incubatorRow ? null : (
        <g>
          <BeanBag x={760} y={512} color="#e0784f" />
          <BeanBag x={802} y={524} color="#5b8def" />
          <RoundTable x={960} y={508} r={14} chairs={3} />
          <Plant x={1110} y={524} />
        </g>
      )}
    </g>
  );
}

export function AgentOffice() {
  const agents = useAgentStore((s) => s.agents);
  const selectedId = useAgentStore((s) => s.selectedAgentId);
  const select = useAgentStore((s) => s.selectAgent);
  const theme = useAgentStore((s) => s.themeMode);
  const flows = useAgentFlows();
  const messages = useRecentAgentMessages();
  const reduced = useReducedMotion();
  const [lightMode, setLightMode] = useState<LightMode>('auto');
  const night = lightMode === 'auto' ? theme === 'dark' : lightMode === 'night';

  const list = useMemo(() => Object.values(agents), [agents]);
  const seats = useMemo(() => assignSeats(list), [list]);
  const bySlot = useMemo(() => {
    const m = new Map<Slot, AgentProfile>();
    list.forEach((a) => {
      const s = seats.get(a.id);
      if (s) m.set(s.slot, a);
    });
    return m;
  }, [list, seats]);
  const rooms = useMemo(() => {
    const m = new Map<RoomId, { members: number; working: number }>();
    list.forEach((a) => {
      const s = seats.get(a.id);
      if (!s) return;
      const cur = m.get(s.room) ?? { members: 0, working: 0 };
      m.set(s.room, { members: cur.members + 1, working: cur.working + (isBusy(a.status) ? 1 : 0) });
    });
    return m;
  }, [list, seats]);

  const pointOf = (id: string) => {
    const s = seats.get(id)?.slot;
    return s ? { x: s.x, y: s.y } : undefined;
  };

  const working = list.filter((a) => isBusy(a.status)).length;
  const devRow = ROOMS.find((r) => r.id === 'Dev Bay')!.slots.some((s) => s.optional && bySlot.has(s));
  const incubatorRow = ROOMS.find((r) => r.id === 'Incubator Pod')!.slots.some((s) => s.optional && bySlot.has(s));

  let deskIndex = 0;
  const desks = ROOMS.flatMap((room) =>
    room.slots
      .filter((s) => !s.optional || bySlot.has(s))
      .map((s) => {
        const a = bySlot.get(s);
        return <Desk key={room.id + s.x + '-' + s.y} x={s.x} y={s.y} facing={s.facing} size={s.size} occupied={!!a} busy={!!a && isBusy(a.status)} accent={a?.accentColor} index={deskIndex++} />;
      })
  );

  const glows = list
    .filter((a) => isBusy(a.status))
    .map((a) => {
      const s = seats.get(a.id)?.slot;
      if (!s) return null;
      const off = -24 - deskDepth(s.size ?? 'std') + 16;
      return <ellipse key={a.id} cx={s.x} cy={s.facing === 'up' ? s.y + off : s.y - off} rx={36} ry={20} fill="url(#ahq-screen)" />;
    });

  const lamps = [...ROOMS.map((r) => ({ id: r.id as string, rect: r.rect })), { id: 'corridor', rect: CORRIDOR }].flatMap(({ id, rect }) => {
    const st = rooms.get(id as RoomId);
    const opacity = st?.working ? (night ? 0.85 : 0.2) : night ? (st?.members || id === 'corridor' ? 0.4 : 0.14) : 0;
    if (!opacity) return [];
    return lightsFor(rect).map((p) => <circle key={id + p.x + '-' + p.y} cx={p.x} cy={p.y} r={id === 'corridor' ? 46 : 84} fill="url(#ahq-lamp)" opacity={opacity} />);
  });

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <div className="relative min-h-[420px] min-w-0 flex-1 bg-canvas">
        <PanZoom contentWidth={PLAN_W} contentHeight={PLAN_H} autoFit maxFitZoom={1.6}>
          {() => (
            <div className="relative" style={{ width: PLAN_W, height: PLAN_H }}>
              <svg width={PLAN_W} height={PLAN_H} className="absolute inset-0" role="img" aria-label="Office floor plan">
                <OfficeDefs />
                <Scenery night={night} />
                <OptionalDecor devRow={devRow} incubatorRow={incubatorRow} />
                {desks}
                <rect width={PLAN_W} height={PLAN_H} rx={16} fill="#050913" style={{ opacity: night ? 0.55 : 0, transition: 'opacity 900ms ease' }} />
                <g style={{ mixBlendMode: 'screen' }}>
                  {lamps}
                  {glows}
                </g>
              </svg>

              <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl transition-opacity duration-1000" style={{ opacity: night ? 0 : 1 }}>
                <div className="ahq-beam absolute -top-10 left-[8%] h-[130%] w-24 bg-gradient-to-b from-amber-100/40 to-transparent blur-xl" />
                <div className="ahq-beam absolute -top-10 left-[38%] h-[130%] w-16 bg-gradient-to-b from-amber-100/30 to-transparent blur-xl" style={{ animationDelay: '-5s' }} />
                <div className="ahq-beam absolute -top-10 left-[72%] h-[130%] w-28 bg-gradient-to-b from-amber-100/35 to-transparent blur-xl" style={{ animationDelay: '-9s' }} />
              </div>
              <div aria-hidden className="pointer-events-none absolute inset-0 rounded-2xl" style={{ boxShadow: 'inset 0 0 120px 10px rgba(0,0,0,0.28)' }} />

              {ROOMS.map((r) => {
                const st = rooms.get(r.id);
                return (
                  <div
                    key={r.id}
                    title={r.purpose}
                    className={cn(
                      'pointer-events-none absolute flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[10.5px] font-semibold shadow-lg backdrop-blur-md transition-colors duration-700',
                      night ? 'border-white/10 bg-[#11151c]/70 text-white/90' : 'border-black/10 bg-white/70 text-neutral-800'
                    )}
                    style={{ left: r.sign.x, top: r.sign.y }}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: r.color, boxShadow: '0 0 8px ' + r.color }} />
                    {r.id}
                    {st?.members ? <span className={cn('font-normal', st.working ? 'text-emerald-500' : 'opacity-60')}>{st.working ? '· ' + st.working + ' working' : '· ' + st.members}</span> : null}
                  </div>
                );
              })}

              <svg width={PLAN_W} height={PLAN_H} className="pointer-events-none absolute inset-0" aria-hidden>
                <FlowLayer flows={flows} pointOf={pointOf} reducedMotion={reduced} />
              </svg>

              {list.map((agent) => {
                const seat = seats.get(agent.id);
                if (!seat) return null;
                const { x, y, facing } = seat.slot;
                const up = facing === 'up';
                const bubble = messages[agent.id];
                const selected = selectedId === agent.id;
                return (
                  <div key={agent.id} data-no-pan className="absolute" style={{ left: x, top: y }}>
                    {bubble ? (
                      <div
                        role="status"
                        className="ahq-bubble ahq-glass pointer-events-none absolute left-0 z-20 w-max max-w-[170px] rounded-xl px-2.5 py-1.5 text-[11px] leading-snug text-fg"
                        style={{ bottom: up ? 20 : 38, transform: 'translateX(-50%)' }}
                      >
                        <span className="line-clamp-2">{bubble}</span>
                        <span className="ahq-typing mt-0.5 block text-fg-subtle" aria-hidden><i /><i /><i /></span>
                      </div>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => select(selected ? null : agent.id)}
                      aria-pressed={selected}
                      aria-label={agent.name + ', ' + agent.title + ', ' + agent.status}
                      title={agent.name + ' · ' + agent.title + (agent.currentTask ? '\n' + agent.currentTask : '')}
                      className={cn('absolute left-0 top-0 flex -translate-x-1/2 -translate-y-1/2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent', selected && 'ring-2 ring-accent')}
                    >
                      {isBusy(agent.status) ? <span aria-hidden className="ahq-halo absolute -inset-2 rounded-full blur-md" style={{ background: agent.accentColor }} /> : null}
                      <span className={cn('relative flex', !isBusy(agent.status) && 'ahq-breathe')} style={{ animationDelay: (agent.name.length % 5) * -0.7 + 's' }}>
                        <AgentAvatar agent={agent} size={30} />
                      </span>
                    </button>
                    <span
                      className="pointer-events-none absolute left-0 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full border border-white/10 bg-black/55 px-2 py-px text-[10px] font-medium leading-tight text-white shadow-lg backdrop-blur-md"
                      style={up ? { top: 19 } : { bottom: 19 }}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_DOT[statusTone(agent.status)] }} />
                      {agent.name}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </PanZoom>
        <div className="ahq-glass pointer-events-none absolute left-3 top-3 flex items-center gap-2.5 rounded-xl px-3 py-1.5" aria-live="polite">
          <span className="relative flex h-2 w-2">
            <span className={cn('absolute inline-flex h-full w-full rounded-full bg-success opacity-60', working > 0 && 'animate-ping')} />
            <span className={cn('relative inline-flex h-2 w-2 rounded-full', working > 0 ? 'bg-success' : 'bg-fg-subtle')} />
          </span>
          <div className="leading-tight">
            <div className="text-[12px] font-semibold text-fg">Live office</div>
            <div className="text-[11px] text-fg-muted">{working > 0 ? working + ' of ' + list.length + ' agents working' : list.length + ' agents standing by'}</div>
          </div>
        </div>
        <div data-no-pan className="ahq-glass absolute bottom-3 right-3 hidden overflow-hidden rounded-xl p-1.5 sm:block" aria-label="Minimap" role="group">
          <svg width={MINI_W} height={MINI_H} viewBox={'0 0 ' + PLAN_W + ' ' + PLAN_H}>
            {ROOMS.map((r) => <rect key={r.id} x={r.rect.x} y={r.rect.y} width={r.rect.w} height={r.rect.h} rx={8} fill={r.color} fillOpacity={0.22} stroke={r.color} strokeOpacity={0.6} strokeWidth={5} />)}
            {list.map((a) => {
              const p = pointOf(a.id);
              if (!p) return null;
              const busy = isBusy(a.status);
              return (
                <g key={a.id} onClick={() => select(selectedId === a.id ? null : a.id)} style={{ cursor: 'pointer' }}>
                  {busy ? <circle cx={p.x} cy={p.y} r={26} fill={a.accentColor} opacity={0.35} className="ahq-halo" style={{ transformOrigin: p.x + 'px ' + p.y + 'px' }} /> : null}
                  <circle cx={p.x} cy={p.y} r={selectedId === a.id ? 20 : 14} fill={a.accentColor} stroke="#fff" strokeWidth={selectedId === a.id ? 6 : 0} />
                  <title>{a.name}</title>
                </g>
              );
            })}
          </svg>
        </div>
        <div className="ahq-glass absolute right-3 top-3 flex items-center gap-0.5 rounded-xl p-0.5" role="radiogroup" aria-label="Lighting">
          {(
            [
              ['auto', SunMoon, 'Follow theme'],
              ['day', Sun, 'Day'],
              ['night', Moon, 'Night'],
            ] as const
          ).map(([mode, Icon, label]) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={lightMode === mode}
              title={label}
              onClick={() => setLightMode(mode)}
              className={cn('flex h-6 items-center gap-1 rounded-lg px-2 text-[11px] transition-colors duration-200', lightMode === mode ? 'bg-surface-3 text-fg shadow-sm' : 'text-fg-muted hover:bg-surface-2 hover:text-fg')}
            >
              <Icon className="h-3.5 w-3.5" />
              {label === 'Follow theme' ? 'Auto' : label}
            </button>
          ))}
        </div>
      </div>
      {selectedId ? null : <VizSidebar flows={flows} />}
    </div>
  );
}
