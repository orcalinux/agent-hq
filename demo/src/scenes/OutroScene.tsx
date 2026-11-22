import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { Card, rise, Tile, useEnter } from '../components/ui';
import { C, mono } from '../theme';
import type { Scene } from '../timeline';

const STEPS = [
  { icon: 'download', title: 'Install', detail: '.deb or .rpm from GitHub Releases', color: C.accent },
  { icon: 'plug', title: 'Connect', detail: 'One subscription is enough', color: C.roles.backend },
  { icon: 'chat', title: 'Ask', detail: 'Give your team its first task', color: C.roles.manager },
];

export const OutroScene = ({ scene }: { scene: Scene }) => {
  const frame = useCurrentFrame();
  const [l0, l1, l2] = scene.voice;
  const bounce = Math.abs(Math.sin((frame - l2.from) / 7)) * 8;
  return (
    <AbsoluteFill style={{ alignItems: 'center' }}>
      <div style={{ marginTop: 150, display: 'flex', alignItems: 'center', gap: 28, ...rise(useEnter(l0.from - 8)) }}>
        <Logo size={110} />
        <span style={{ fontSize: 96, fontWeight: 700, color: C.fg, letterSpacing: -3 }}>Agent HQ</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 30, marginTop: 70 }}>
        {STEPS.map((s, i) => {
          const p = useEnter(l1.from + Math.round((l1.frames * i) / 3.2));
          return (
            <div key={s.title} style={{ display: 'flex', ...rise(p, 40) }}>
              <Card style={{ boxSizing: 'border-box', width: 420, minHeight: '100%', padding: 30, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <Tile color={s.color} size={60}>
                    <Icon name={s.icon} size={30} />
                  </Tile>
                  <span style={{ fontSize: 22, color: C.subtle, fontWeight: 600 }}>{i + 1}</span>
                  <span style={{ fontSize: 36, fontWeight: 700, color: C.fg }}>{s.title}</span>
                </div>
                <span style={{ fontSize: 26, color: C.muted }}>{s.detail}</span>
              </Card>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 26, marginTop: 64, ...rise(useEnter(l2.from)) }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 24px', borderRadius: 999, background: C.accent, color: '#0b1220', fontSize: 28, fontWeight: 700, boxShadow: `0 0 40px ${C.accent}88` }}>
          <div style={{ transform: `translateY(${-bounce}px)` }}>
            <Icon name="up" size={28} width={3} />
          </div>
          Update ready
        </div>
        <span style={{ fontFamily: mono, fontSize: 28, color: C.muted, opacity: interpolate(frame, [l2.from + 20, l2.from + 40], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>
          github.com/orcalinux/agent-hq
        </span>
      </div>
    </AbsoluteFill>
  );
};
