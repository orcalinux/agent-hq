import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, Easing } from 'remotion';
import manifest from '../../public/shots/manifest.json';
import { Cursor } from '../components/Cursor';
import { C } from '../theme';
import { lineStart, type Scene, type Step } from '../timeline';

type Box = { x: number; y: number; width: number; height: number };
const shots = manifest.shots as Record<string, { file: string; target?: Box; focus?: Box }>;
const VIEW = manifest.viewport;

const WIN = { w: 1536, h: 864 };
const WIN_LEFT = (1920 - WIN.w) / 2;
const WIN_TOP = 96;
const K = WIN.w / VIEW.width;

interface Camera { s: number; tx: number; ty: number }
const FULL: Camera = { s: 1, tx: 0, ty: 0 };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function cameraFor(step: Step): Camera {
  const shot = shots[step.shot];
  const focus = step.zoom ? shot?.focus ?? shot?.target : step.action ? shot?.target : undefined;
  if (!focus) return FULL;
  const s = step.zoom ? clamp(Math.min((0.82 * VIEW.width) / focus.width, (0.78 * VIEW.height) / focus.height), 1.45, 2.1) : 1.3;
  const cx = (focus.x + focus.width / 2) * K;
  const cy = (focus.y + focus.height / 2) * K;
  return { s, tx: clamp(WIN.w / 2 - cx * s, WIN.w - WIN.w * s, 0), ty: clamp(WIN.h / 2 - cy * s, WIN.h - WIN.h * s, 0) };
}

const mix = (a: Camera, b: Camera, p: number): Camera => ({ s: a.s + (b.s - a.s) * p, tx: a.tx + (b.tx - a.tx) * p, ty: a.ty + (b.ty - a.ty) * p });
const project = (cam: Camera, x: number, y: number) => ({ x: WIN_LEFT + cam.tx + x * K * cam.s, y: WIN_TOP + cam.ty + y * K * cam.s });

interface Window { step: Step; start: number; end: number; from: Camera; to: Camera; actionAt: number }

function layout(scene: Scene): Window[] {
  const steps = scene.steps ?? [];
  return steps.map((step, i) => {
    const start = i === 0 ? 0 : lineStart(scene, step.at) - 8;
    const end = i === steps.length - 1 ? scene.frames : lineStart(scene, steps[i + 1].at) - 8;
    const prev = steps[i - 1];
    const from = prev && prev.shot === step.shot ? cameraFor(prev) : FULL;
    const lastLine = Math.max(step.at, (steps[i + 1]?.at ?? scene.voice.length) - 1);
    const last = scene.voice[lastLine];
    const zoomLead = step.zoom ? 34 : 12;
    const actionAt = clamp(Math.round(last.from + last.frames * 0.45), start + zoomLead + 22, end - 22);
    return { step, start, end, from, to: cameraFor(step), actionAt };
  });
}

const Ring = ({ box, cam, t, pulse }: { box: Box; cam: Camera; t: number; pulse: number }) => {
  const a = project(cam, box.x, box.y);
  const pad = 6;
  const w = box.width * K * cam.s + pad * 2;
  const h = box.height * K * cam.s + pad * 2;
  return (
    <div
      style={{
        position: 'absolute',
        left: a.x - pad,
        top: a.y - pad,
        width: w,
        height: h,
        borderRadius: 12,
        border: `2.5px solid ${C.accent}`,
        boxShadow: `0 0 ${18 + pulse * 18}px rgba(106,163,255,${0.35 + pulse * 0.3}), inset 0 0 12px rgba(106,163,255,0.15)`,
        opacity: t,
        transform: `scale(${1.08 - t * 0.08})`,
      }}
    />
  );
};

export const ShotsScene = ({ scene }: { scene: Scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const windows = layout(scene);
  const enter = spring({ frame, fps, config: { damping: 22, stiffness: 90, mass: 0.9 } });

  const camAt = (w: Window) => {
    const p = spring({ frame: frame - w.start - 10, fps, config: { damping: 200 }, durationInFrames: 34 });
    const drift = interpolate(frame, [w.start, w.end], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    const cam = mix(w.from, w.to, p);
    const breathe = 1 + drift * 0.018;
    return { s: cam.s * breathe, tx: cam.tx - (WIN.w * (breathe - 1)) / 2 * cam.s, ty: cam.ty - (WIN.h * (breathe - 1)) / 2 * cam.s };
  };

  let cursor: { x: number; y: number; press: number; ripple: number; opacity: number; ripplePos?: { x: number; y: number } } | null = null;
  let lastPos: { x: number; y: number } | null = null;
  for (const w of windows) {
    const target = shots[w.step.shot]?.target;
    if (!w.step.action || !target) continue;
    if (frame < w.start) break;
    const cam = camAt(w);
    const goal = project(cam, target.x + target.width / 2, target.y + target.height / 2);
    const appearing = lastPos === null;
    const startPos: { x: number; y: number } = lastPos ?? { x: goal.x + 150, y: goal.y + 190 };
    const opacity = appearing ? interpolate(frame, [w.actionAt - 34, w.actionAt - 24], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : 1;
    const move = interpolate(frame, [w.actionAt - 24, w.actionAt], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.45, 0, 0.2, 1) });
    const arc = Math.sin(move * Math.PI) * -40;
    const pos: { x: number; y: number } = { x: startPos.x + (goal.x - startPos.x) * move, y: startPos.y + (goal.y - startPos.y) * move + arc };
    const since = frame - w.actionAt;
    const press = w.step.action === 'click' ? interpolate(since, [0, 3, 9], [0, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : 0;
    const ripple = w.step.action === 'click' && since >= 0 ? since : -1;
    if (frame < w.end) cursor = { ...pos, press, ripple, opacity, ripplePos: goal };
    lastPos = frame >= w.actionAt ? goal : pos;
  }

  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          left: WIN_LEFT,
          top: WIN_TOP,
          width: WIN.w,
          height: WIN.h,
          borderRadius: 18,
          overflow: 'hidden',
          border: `1px solid rgba(255,255,255,0.12)`,
          boxShadow: '0 40px 120px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,0,0,0.5), 0 0 90px rgba(106,163,255,0.10)',
          background: C.bg,
          opacity: enter,
          transform: `perspective(2400px) rotateX(${interpolate(enter, [0, 1], [10, 0])}deg) scale(${interpolate(enter, [0, 1], [0.94, 1])})`,
        }}
      >
        {windows.map((w, i) => {
          if (frame < w.start - 1 || frame > w.end + 12) return null;
          const sameAsPrev = i > 0 && windows[i - 1].step.shot === w.step.shot;
          const fadeIn = i === 0 || sameAsPrev ? 1 : interpolate(frame, [w.start, w.start + 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
          const cam = camAt(w);
          return (
            <Img
              key={i}
              src={staticFile(`shots/${shots[w.step.shot].file}`)}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: WIN.w,
                height: WIN.h,
                opacity: fadeIn,
                transformOrigin: '0 0',
                transform: `translate(${cam.tx}px, ${cam.ty}px) scale(${cam.s})`,
              }}
            />
          );
        })}
      </div>
      {windows.map((w, i) => {
        const target = shots[w.step.shot]?.target;
        if (!w.step.action || !target || frame < w.actionAt - 4 || frame > w.end + 4) return null;
        const t = spring({ frame: frame - w.actionAt + 2, fps, config: { damping: 18 } });
        const out = interpolate(frame, [w.end - 6, w.end + 4], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
        const pulse = (Math.sin((frame - w.actionAt) / 6) + 1) / 2;
        return <Ring key={i} box={target} cam={camAt(w)} t={t * out} pulse={pulse} />;
      })}
      {cursor && cursor.ripple >= 0 && cursor.ripple < 22 && cursor.ripplePos ? (
        <div
          style={{
            position: 'absolute',
            left: cursor.ripplePos.x - 40,
            top: cursor.ripplePos.y - 40,
            width: 80,
            height: 80,
            borderRadius: '50%',
            border: `3px solid ${C.accent}`,
            opacity: interpolate(cursor.ripple, [0, 22], [0.9, 0]),
            transform: `scale(${interpolate(cursor.ripple, [0, 22], [0.2, 1.4])})`,
          }}
        />
      ) : null}
      {cursor && cursor.opacity > 0 ? <div style={{ opacity: cursor.opacity }}><Cursor x={cursor.x} y={cursor.y} press={cursor.press} /></div> : null}
    </AbsoluteFill>
  );
};
