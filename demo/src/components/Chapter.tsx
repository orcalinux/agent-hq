import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { C } from '../theme';
import { Logo } from './Logo';

export const Chapter = ({ label }: { label: string }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - 6, fps, config: { damping: 200 } });
  return (
    <AbsoluteFill style={{ padding: '30px 40px', pointerEvents: 'none' }}>
      <div
        style={{
          alignSelf: 'flex-start',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '9px 18px 9px 10px',
          borderRadius: 999,
          background: 'rgba(22,23,27,0.88)',
          border: `1px solid ${C.line}`,
          boxShadow: '0 8px 30px rgba(0,0,0,0.35)',
          opacity: enter,
          transform: `translateX(${interpolate(enter, [0, 1], [-24, 0])}px)`,
        }}
      >
        <Logo size={30} />
        <span style={{ color: C.fg, fontSize: 24, fontWeight: 600, letterSpacing: -0.2 }}>{label}</span>
      </div>
    </AbsoluteFill>
  );
};
