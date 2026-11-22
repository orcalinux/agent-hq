import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { C } from '../theme';
import type { Line } from '../timeline';

/** One subtitle at a time, matched to the narration clip it belongs to. */
export const Captions = ({ lines }: { lines: Line[] }) => {
  const frame = useCurrentFrame();
  const line = lines.find((l, i) => frame >= l.from - 4 && frame < (lines[i + 1]?.from ?? l.from + l.frames + 20) - 4);
  if (!line) return null;
  const local = frame - line.from;
  const end = line.frames + 12;
  const opacity = interpolate(local, [-4, 4, end - 6, end + 4], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const y = interpolate(local, [-4, 6], [10, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 34, pointerEvents: 'none' }}>
      <div
        style={{
          opacity,
          transform: `translateY(${y}px)`,
          maxWidth: 1400,
          padding: '12px 26px',
          borderRadius: 14,
          background: 'rgba(10,11,14,0.82)',
          border: `1px solid ${C.line}`,
          boxShadow: '0 10px 40px rgba(0,0,0,0.45)',
          color: C.fg,
          fontSize: 34,
          lineHeight: 1.3,
          fontWeight: 500,
          textAlign: 'center',
          letterSpacing: -0.2,
        }}
      >
        {line.text}
      </div>
    </AbsoluteFill>
  );
};
