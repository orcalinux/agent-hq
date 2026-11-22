import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { Logo } from '../components/Logo';
import { Card, rise, useEnter } from '../components/ui';
import { C, mono } from '../theme';
import type { Scene } from '../timeline';

export const TitleScene = ({ scene }: { scene: Scene }) => {
  const frame = useCurrentFrame();
  const [l0, l1, l2, l3] = scene.voice.map((l) => l.from);
  const draw = interpolate(frame, [4, 46], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const logo = useEnter(0, 14);
  const lift = useEnter(l1 - 6, 200);
  const words = ['Plans', 'Builds', 'Reviews'];
  const diff = useEnter(l3);
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', transform: `translateY(${interpolate(lift, [0, 1], [70, -40])}px)` }}>
        <div style={{ transform: `scale(${interpolate(logo, [0, 1], [0.6, 1])})`, filter: `drop-shadow(0 0 ${40 * draw}px rgba(106,163,255,0.45))` }}>
          <Logo size={200} draw={draw} />
        </div>
        <div style={{ display: 'flex', marginTop: 28 }}>
          {'Agent HQ'.split('').map((ch, i) => {
            const p = useEnter(l0 + 8 + i * 2, 14);
            return <span key={i} style={{ fontSize: 120, fontWeight: 700, letterSpacing: -4, color: C.fg, whiteSpace: 'pre', ...rise(p, 40) }}>{ch}</span>;
          })}
        </div>
        <div style={{ fontSize: 40, color: C.muted, marginTop: 6, ...rise(useEnter(l1)) }}>
          Your AI software team, on your desktop.
        </div>
        <div style={{ display: 'flex', gap: 18, marginTop: 44, height: 64 }}>
          {words.map((w, i) => {
            const p = useEnter(l2 + 10 + i * 14);
            return (
              <div key={w} style={{ padding: '12px 28px', borderRadius: 999, fontSize: 30, fontWeight: 600, color: C.fg, background: 'rgba(106,163,255,0.12)', border: '1px solid rgba(106,163,255,0.35)', ...rise(p) }}>
                {w}
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 30, height: 120, ...rise(diff) }}>
          <Card style={{ padding: '18px 26px', fontFamily: mono, fontSize: 24, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ color: '#f87171' }}>- export const greeting = 'Hello';</span>
            <span style={{ color: C.success }}>+ export const greeting = (name) =&gt; `Hello, ${'{'}name{'}'}!`;</span>
          </Card>
        </div>
      </div>
    </AbsoluteFill>
  );
};
