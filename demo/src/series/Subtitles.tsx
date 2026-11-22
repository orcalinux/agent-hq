import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { C } from '../theme';
import { captionChunks, type Voice } from './plan';

/** One short caption at a time under the stage, cut from the narration line by sentence. */
export const Subtitles = ({ voice, top = 948 }: { voice: Voice[]; top?: number }) => {
  const frame = useCurrentFrame();
  const chunks = voice.flatMap((line) => captionChunks(line));
  const index = chunks.findIndex((c, i) => frame >= c.from - 3 && frame < (chunks[i + 1] && chunks[i + 1].from - c.from < c.frames + 30 ? chunks[i + 1].from - 3 : c.from + c.frames + 14));
  if (index < 0) return null;
  const chunk = chunks[index];
  const local = frame - chunk.from;
  const continued = index > 0 && chunk.from - (chunks[index - 1].from + chunks[index - 1].frames) < 4;
  const opacity = continued ? 1 : interpolate(local, [-3, 4], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const end = chunk.frames + 14;
  const fade = interpolate(local, [end - 6, end], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', top, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
        <div
          style={{
            opacity: opacity * fade, maxWidth: 1480, padding: '10px 26px', borderRadius: 14, background: 'rgba(12,13,17,0.86)', border: `1px solid ${C.line}`,
            boxShadow: '0 10px 40px rgba(0,0,0,0.45)', color: C.fg, fontSize: 33, lineHeight: 1.32, fontWeight: 500, textAlign: 'center', letterSpacing: -0.2,
          }}
        >
          {chunk.text}
        </div>
      </div>
    </AbsoluteFill>
  );
};
