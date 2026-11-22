import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { C } from '../theme';

/** Slow drifting light behind every scene, so cuts between scenes never flash to flat black. */
export const Backdrop = () => {
  const t = useCurrentFrame() / 30;
  const a = { x: 30 + Math.sin(t / 7) * 12, y: 20 + Math.cos(t / 9) * 10 };
  const b = { x: 75 + Math.cos(t / 8) * 10, y: 80 + Math.sin(t / 6) * 8 };
  return (
    <AbsoluteFill
      style={{
        backgroundColor: C.bg,
        backgroundImage: [
          `radial-gradient(900px 600px at ${a.x}% ${a.y}%, rgba(106,163,255,0.16), transparent 70%)`,
          `radial-gradient(800px 560px at ${b.x}% ${b.y}%, rgba(143,134,255,0.13), transparent 70%)`,
          'radial-gradient(rgba(255,255,255,0.045) 1px, transparent 1px)',
        ].join(','),
        backgroundSize: 'auto, auto, 28px 28px',
      }}
    />
  );
};
