import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { Icon } from '../components/Icon';
import { Card, rise, Tile, useEnter } from '../components/ui';
import { C } from '../theme';
import type { Scene } from '../timeline';

interface Member { name: string; title: string; icon: string; color: string; x: number; y: number; line: number; offset: number; parent?: string; mentor?: boolean }

const TEAM: Member[] = [
  { name: 'Sovereign', title: 'Orchestrator · plans with you', icon: 'crown', color: C.roles.manager, x: 960, y: 250, line: 1, offset: 0 },
  { name: 'Aegis', title: 'Architect', icon: 'compass', color: C.roles.architect, x: 390, y: 540, line: 3, offset: 0, parent: 'Sovereign' },
  { name: 'Pulse', title: 'Frontend', icon: 'palette', color: C.roles.frontend, x: 770, y: 540, line: 3, offset: 0.33, parent: 'Sovereign' },
  { name: 'Titan', title: 'Backend', icon: 'server', color: C.roles.backend, x: 1150, y: 540, line: 3, offset: 0.66, parent: 'Sovereign' },
  { name: 'Sentinel', title: 'QA & security', icon: 'shield', color: C.roles.qa, x: 1530, y: 540, line: 4, offset: 0, parent: 'Sovereign' },
  { name: 'Nova', title: 'Junior · frontend', icon: 'sprout', color: C.roles.junior, x: 770, y: 800, line: 5, offset: 0.1, parent: 'Pulse', mentor: true },
  { name: 'Byte', title: 'Junior · backend', icon: 'sprout', color: C.roles.junior, x: 1150, y: 800, line: 5, offset: 0.25, parent: 'Titan', mentor: true },
];
const W = 330;
const H = 120;

export const TeamScene = ({ scene }: { scene: Scene }) => {
  const frame = useCurrentFrame();
  const at = (m: Member) => scene.voice[m.line].from + Math.round(scene.voice[m.line].frames * m.offset);
  const speaking = scene.voice.findIndex((l, i) => frame >= l.from && frame < (scene.voice[i + 1]?.from ?? Infinity));
  const byName = Object.fromEntries(TEAM.map((m) => [m.name, m]));
  return (
    <AbsoluteFill>
      <svg width={1920} height={1080} style={{ position: 'absolute' }}>
        {TEAM.filter((m) => m.parent).map((m) => {
          const p = byName[m.parent!];
          const draw = interpolate(frame, [at(m) - 4, at(m) + 16], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
          const y1 = p.y + H / 2;
          const y2 = m.y - H / 2;
          const mid = (y1 + y2) / 2;
          return (
            <path
              key={m.name}
              d={`M ${p.x} ${y1} C ${p.x} ${mid}, ${m.x} ${mid}, ${m.x} ${y2}`}
              stroke={m.mentor ? C.roles.junior : 'rgba(255,255,255,0.22)'}
              strokeWidth={m.mentor ? 2.5 : 2}
              fill="none"
              pathLength={1}
              strokeDasharray={m.mentor ? '0.03 0.02' : 1}
              strokeDashoffset={m.mentor ? 0 : 1 - draw}
              opacity={m.mentor ? draw : 1}
            />
          );
        })}
      </svg>
      {TEAM.filter((m) => m.mentor).map((m) => {
        const p = byName[m.parent!];
        return (
          <div key={m.name + 'tag'} style={{ position: 'absolute', left: (p.x + m.x) / 2 + 14, top: (p.y + m.y) / 2 - 16, fontSize: 20, color: C.roles.junior, fontWeight: 600, ...rise(useEnter(at(m) + 10)) }}>
            mentor
          </div>
        );
      })}
      {TEAM.map((m) => {
        const p = useEnter(at(m), 13);
        const lit = speaking === m.line || (m.name === 'Sovereign' && speaking === 2);
        return (
          <div key={m.name} style={{ position: 'absolute', left: m.x - W / 2, top: m.y - H / 2, width: W, ...rise(p, 30) }}>
            <Card glow={lit ? m.color : undefined} style={{ height: H, display: 'flex', alignItems: 'center', gap: 18, padding: '0 22px' }}>
              <Tile color={m.color} size={66}>
                <Icon name={m.icon} size={32} />
              </Tile>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 32, fontWeight: 700, color: C.fg }}>{m.name}</span>
                <span style={{ fontSize: 20, color: C.muted, whiteSpace: 'nowrap' }}>{m.title}</span>
              </div>
            </Card>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
