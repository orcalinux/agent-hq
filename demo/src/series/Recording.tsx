import { AbsoluteFill, interpolate, OffthreadVideo, staticFile, useCurrentFrame } from 'remotion';
import { Logo } from '../components/Logo';
import { C, FPS } from '../theme';
import { cameraAt, pointerAt, type EpisodeDef, type EpisodePlan } from './plan';

/** Where the app window sits in the 1920×1080 frame; the band below it holds the captions. */
export const STAGE = { x: 192, y: 76, width: 1536, height: 864 };

const Pointer = ({ scale, pressed }: { scale: number; pressed: number }) => (
  <svg width={30} height={30} viewBox="0 0 24 24" style={{ transform: `scale(${scale * (1 - pressed * 0.14)})`, transformOrigin: '3px 2px', filter: 'drop-shadow(0 3px 6px rgba(0,0,0,0.55))', overflow: 'visible' }}>
    <path d="M3 2 L3 19.5 L7.6 15.4 L10.6 22 L13.7 20.6 L10.8 14.2 L17 14 Z" fill="#ffffff" stroke="#0d0e11" strokeWidth={1.4} strokeLinejoin="round" />
  </svg>
);

export const Recording = ({ ep, plan }: { ep: EpisodeDef; plan: EpisodePlan }) => {
  const frame = useCurrentFrame();
  const { capture, rec } = plan;
  const t = rec.trim + frame / FPS;
  const view = capture.view;
  const fit = STAGE.width / view.width;
  const cam = cameraAt(capture, t);
  const k = fit * cam.s;
  const tx = -(cam.cx - view.width / (2 * cam.s));
  const ty = -(cam.cy - view.height / (2 * cam.s));
  const pointer = pointerAt(capture, t);
  const recent = capture.clicks.filter((c) => t >= c.t && t - c.t < 0.6);
  const pressed = capture.clicks.some((c) => Math.abs(t - c.t) < 0.09) ? 1 : 0;

  const current = [...rec.cues].reverse().find((c) => frame >= c.from - 6) ?? rec.cues[0];
  const stepIndex = Math.max(0, ep.steps.findIndex((s) => s.id === current.step));
  const stepCue = rec.cues.find((c) => c.step === ep.steps[stepIndex].id)!;
  const stepEnter = interpolate(frame, [stepCue.from - 6, stepCue.from + 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: STAGE.x, top: 20, height: 40, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Logo size={34} />
        <span style={{ color: C.muted, fontSize: 21, fontWeight: 500 }}>Agent HQ tutorials</span>
        <span style={{ color: C.subtle, fontSize: 21 }}>/</span>
        <span style={{ color: C.fg, fontSize: 21, fontWeight: 600, whiteSpace: 'nowrap' }}>{String(ep.number).padStart(2, '0')} · {ep.title}</span>
      </div>
      <div style={{ position: 'absolute', right: 1920 - STAGE.x - STAGE.width, top: 20, height: 40, display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {ep.steps.map((s, i) => (
            <div key={s.id} style={{ width: i === stepIndex ? 34 : 12, height: 8, borderRadius: 99, background: i < stepIndex ? `${C.accent}99` : i === stepIndex ? C.accent : 'rgba(255,255,255,0.14)', boxShadow: i === stepIndex ? `0 0 12px ${C.accent}88` : undefined }} />
          ))}
        </div>
        <span style={{ color: C.subtle, fontSize: 19, fontWeight: 500, whiteSpace: 'nowrap' }}>Step {stepIndex + 1} of {ep.steps.length}</span>
        <span style={{ color: C.fg, fontSize: 21, fontWeight: 600, whiteSpace: 'nowrap', opacity: stepEnter, transform: `translateY(${(1 - stepEnter) * 8}px)` }}>{ep.steps[stepIndex].label}</span>
      </div>

      <div
        style={{
          position: 'absolute', left: STAGE.x, top: STAGE.y, width: STAGE.width, height: STAGE.height, overflow: 'hidden', borderRadius: 16, background: C.bg,
          boxShadow: `0 0 0 1px rgba(255,255,255,0.09), 0 30px 90px rgba(0,0,0,0.55), 0 0 80px rgba(106,163,255,0.08)`,
        }}
      >
        <div style={{ position: 'absolute', left: 0, top: 0, width: view.width, height: view.height, transformOrigin: '0 0', transform: `scale(${k}) translate(${tx}px, ${ty}px)` }}>
          <OffthreadVideo src={staticFile(`episodes/${ep.id}/recording.mp4`)} trimBefore={Math.round(rec.trim * FPS)} muted style={{ width: view.width, height: view.height, display: 'block' }} />
          {recent.map((c) => {
            const p = (t - c.t) / 0.6;
            return (
              <div key={c.t} style={{ position: 'absolute', left: c.x, top: c.y, width: 0, height: 0 }}>
                <div style={{ position: 'absolute', left: -22 / cam.s, top: -22 / cam.s, width: 44 / cam.s, height: 44 / cam.s, borderRadius: '50%', border: `${2.5 / cam.s}px solid ${C.accent}`, background: `${C.accent}33`, opacity: 1 - p, transform: `scale(${0.4 + p * 1.1})` }} />
              </div>
            );
          })}
          {pointer.visible ? (
            <div style={{ position: 'absolute', left: pointer.x - 3 / k, top: pointer.y - 2 / k, transformOrigin: '0 0', transform: `scale(${1 / k})` }}>
              <Pointer scale={1} pressed={pressed} />
            </div>
          ) : null}
        </div>
      </div>
    </AbsoluteFill>
  );
};
