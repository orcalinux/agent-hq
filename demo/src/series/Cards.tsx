import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { Card, rise, useEnter } from '../components/ui';
import { C, mono } from '../theme';
import { nextEpisode, type EpisodeDef, type Part } from './plan';

const pad = (n: number) => String(n).padStart(2, '0');

const Brand = () => (
  <div style={{ position: 'absolute', left: 140, top: 70, display: 'flex', alignItems: 'center', gap: 14, ...rise(useEnter(2)) }}>
    <Logo size={46} />
    <span style={{ color: C.muted, fontSize: 26, fontWeight: 500 }}>Agent HQ tutorials</span>
  </div>
);

export const IntroCard = ({ ep, part }: { ep: EpisodeDef; part: Part }) => {
  const frame = useCurrentFrame();
  const [l0, l1] = part.voice;
  const number = useEnter(4, 18);
  const title = useEnter(l0.from - 2);
  const subtitle = useEnter(l0.from + 12);
  const listAt = l1 ? l1.from : l0.from + l0.frames;
  return (
    <AbsoluteFill>
      <Brand />
      <div style={{ position: 'absolute', left: 140, top: 250, width: 900 }}>
        <div
          style={{
            fontSize: 210, fontWeight: 700, lineHeight: 1, letterSpacing: -8, backgroundImage: `linear-gradient(135deg, ${C.accent}, ${C.accent2})`,
            WebkitBackgroundClip: 'text', color: 'transparent', opacity: number, transform: `translateY(${(1 - number) * 30}px)`,
          }}
        >
          {pad(ep.number)}
        </div>
        <div style={{ marginTop: 18, fontSize: 86, fontWeight: 700, color: C.fg, letterSpacing: -2.5, lineHeight: 1.05, ...rise(title, 30) }}>{ep.title}</div>
        <div style={{ marginTop: 22, fontSize: 36, color: C.muted, lineHeight: 1.3, ...rise(subtitle, 20) }}>{ep.subtitle}</div>
      </div>
      <div style={{ position: 'absolute', right: 140, top: 250, width: 640 }}>
        <Card style={{ padding: '30px 34px', ...rise(useEnter(listAt - 10), 30) }}>
          <div style={{ color: C.subtle, fontSize: 20, fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 18 }}>In this episode</div>
          {ep.steps.map((s, i) => {
            const p = useEnter(listAt + i * 7);
            return (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '13px 0', borderTop: i ? `1px solid ${C.line}` : undefined, ...rise(p, 16) }}>
                <div style={{ width: 42, height: 42, flexShrink: 0, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'rgba(106,163,255,0.12)', border: '1px solid rgba(106,163,255,0.35)', color: C.accent, fontSize: 21, fontWeight: 700 }}>{i + 1}</div>
                <span style={{ color: C.fg, fontSize: 30, fontWeight: 500 }}>{s.label}</span>
              </div>
            );
          })}
        </Card>
      </div>
      <div style={{ position: 'absolute', left: 140, bottom: 170, display: 'flex', alignItems: 'center', gap: 12, color: C.subtle, fontSize: 22, opacity: interpolate(frame, [l0.from + 20, l0.from + 40], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>
        <div style={{ width: 9, height: 9, borderRadius: 99, background: C.success, boxShadow: `0 0 10px ${C.success}` }} />
        Recorded in the real app · model replies are scripted, so no account credit is used
      </div>
    </AbsoluteFill>
  );
};

export const OutroCard = ({ ep, part }: { ep: EpisodeDef; part: Part }) => {
  const [l0, l1] = part.voice;
  const next = nextEpisode(ep.id);
  const badge = useEnter(4, 14);
  const card = useEnter(l0.from + 2);
  const nextAt = l1 ? l1.from : l0.from + l0.frames;
  return (
    <AbsoluteFill style={{ alignItems: 'center' }}>
      <Brand />
      <div style={{ marginTop: 190, display: 'flex', alignItems: 'center', gap: 22, ...rise(badge, 24) }}>
        <div style={{ width: 78, height: 78, borderRadius: 24, display: 'grid', placeItems: 'center', background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.45)', color: C.success, boxShadow: '0 0 40px rgba(74,222,128,0.25)' }}>
          <Icon name="check" size={42} />
        </div>
        <span style={{ fontSize: 72, fontWeight: 700, color: C.fg, letterSpacing: -2 }}>Episode {pad(ep.number)} complete</span>
      </div>
      <Card style={{ marginTop: 56, width: 1260, padding: '18px 40px', ...rise(card, 20) }}>
        {ep.recap.map((item, i) => {
          const p = useEnter(l0.from + 8 + Math.round((l0.frames * i) / (ep.recap.length + 0.5)));
          return (
            <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '20px 0', borderTop: i ? `1px solid ${C.line}` : undefined, ...rise(p, 16) }}>
              <div style={{ color: C.success, flexShrink: 0 }}><Icon name="check" size={34} /></div>
              <span style={{ color: C.fg, fontSize: 34, fontWeight: 500 }}>{item}</span>
            </div>
          );
        })}
      </Card>
      <div style={{ marginTop: 50, ...rise(useEnter(nextAt - 4), 20) }}>
        {next ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 30px', borderRadius: 999, background: 'rgba(106,163,255,0.12)', border: '1px solid rgba(106,163,255,0.4)', boxShadow: '0 0 40px rgba(106,163,255,0.2)' }}>
            <span style={{ color: C.accent, fontSize: 28, fontWeight: 700 }}>Next</span>
            <span style={{ color: C.fg, fontSize: 30, fontWeight: 600 }}>{pad(next.number)} · {next.title}</span>
          </div>
        ) : (
          <span style={{ fontFamily: mono, fontSize: 30, color: C.muted }}>github.com/orcalinux/agent-hq</span>
        )}
      </div>
    </AbsoluteFill>
  );
};
