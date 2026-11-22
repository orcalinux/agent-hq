import type { CSSProperties, ReactNode } from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { C } from '../theme';

/** Springs from 0 to 1 starting at `at`; the shared entrance curve for every animated element. */
export function useEnter(at: number, damping = 16) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - at, fps, config: { damping, stiffness: 120, mass: 0.8 } });
}

export const rise = (p: number, distance = 24): CSSProperties => ({ opacity: Math.min(1, p * 1.4), transform: `translateY(${interpolate(p, [0, 1], [distance, 0])}px) scale(${interpolate(p, [0, 1], [0.96, 1])})` });

export const Card = ({ children, style, glow }: { children: ReactNode; style?: CSSProperties; glow?: string }) => (
  <div
    style={{
      background: 'linear-gradient(180deg, rgba(30,31,37,0.96), rgba(20,21,25,0.96))',
      border: `1px solid ${glow ? glow + '88' : C.line}`,
      borderRadius: 20,
      boxShadow: glow ? `0 0 0 1px ${glow}33, 0 18px 60px rgba(0,0,0,0.45), 0 0 50px ${glow}40` : '0 18px 60px rgba(0,0,0,0.45)',
      ...style,
    }}
  >
    {children}
  </div>
);

export const Tile = ({ color, children, size = 64 }: { color: string; children: ReactNode; size?: number }) => (
  <div style={{ width: size, height: size, borderRadius: size * 0.3, display: 'grid', placeItems: 'center', background: `${color}1f`, border: `1px solid ${color}55`, color, boxShadow: `0 0 24px ${color}30`, flexShrink: 0 }}>
    {children}
  </div>
);
