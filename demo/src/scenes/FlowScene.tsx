import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { Icon } from '../components/Icon';
import { Card, rise, Tile, useEnter } from '../components/ui';
import { C } from '../theme';
import type { Scene } from '../timeline';

const NODES = [
  { icon: 'chat', title: 'Ask', who: 'You', color: C.accent },
  { icon: 'plan', title: 'Plan', who: 'Sovereign', color: C.roles.manager },
  { icon: 'check', title: 'Approve', who: 'You', color: C.accent },
  { icon: 'code', title: 'Build', who: 'Agents', color: C.roles.backend },
  { icon: 'shield', title: 'Review', who: 'Sentinel', color: C.roles.qa },
  { icon: 'diff', title: 'Changes', who: 'You', color: C.success },
];

export const FlowScene = ({ scene }: { scene: Scene }) => {
  const frame = useCurrentFrame();
  const [, l1, l2] = scene.voice;
  const appearAt = (i: number) => {
    const line = i < 3 ? l1 : l2;
    return line.from + Math.round((line.frames * (i % 3)) / 3.2);
  };
  const W = 230;
  const GAPX = 54;
  const total = NODES.length * W + (NODES.length - 1) * GAPX;
  const left = (1920 - total) / 2;
  const track = interpolate(frame, [8, 40], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const lit = NODES.filter((_, i) => frame >= appearAt(i)).length;
  const dotX = ((frame - l1.from) * 7) % Math.max(1, (lit > 0 ? (lit - 1) * (W + GAPX) : 1) + 1);
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', top: 250, width: '100%', textAlign: 'center', fontSize: 58, fontWeight: 700, color: C.fg, letterSpacing: -1.5, ...rise(useEnter(scene.voice[0].from)) }}>
        One path for every task
      </div>
      <div style={{ position: 'absolute', left: left + W / 2, top: 540, height: 4, width: (total - W) * track, borderRadius: 4, background: 'linear-gradient(90deg, rgba(106,163,255,0.5), rgba(143,134,255,0.5))' }} />
      {lit > 1 ? (
        <div style={{ position: 'absolute', left: left + W / 2 + dotX - 10, top: 532, width: 20, height: 20, borderRadius: '50%', background: '#fff', boxShadow: `0 0 24px 8px ${C.accent}` }} />
      ) : null}
      {NODES.map((n, i) => {
        const p = useEnter(appearAt(i));
        const active = lit - 1 === i;
        return (
          <div key={n.title} style={{ position: 'absolute', left: left + i * (W + GAPX), top: 430, width: W, ...rise(p, 40) }}>
            <Card glow={active ? n.color : undefined} style={{ height: 220, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
              <Tile color={n.color} size={76}>
                <Icon name={n.icon} size={36} />
              </Tile>
              <div style={{ fontSize: 34, fontWeight: 700, color: C.fg }}>{n.title}</div>
              <div style={{ fontSize: 22, color: C.muted, marginTop: -8 }}>{n.who}</div>
            </Card>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
