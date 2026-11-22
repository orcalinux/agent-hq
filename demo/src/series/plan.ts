import { staticFile } from 'remotion';
import series from './episodes.json';
import { FPS } from '../theme';

export interface StepDef { id: string; label: string }
export interface CueDef { id: string; step: string; text: string }
export interface EpisodeDef {
  id: string;
  number: number;
  title: string;
  subtitle: string;
  file: string;
  intro: string[];
  steps: StepDef[];
  cues: CueDef[];
  outro: string[];
  recap: string[];
}

export type Box = { x: number; y: number; width: number; height: number };
export interface CaptureLog {
  episode: string;
  view: { width: number; height: number };
  duration: number;
  cues: Array<{ id: string; t: number }>;
  camera: Array<{ t: number; box: Box | null; zoom?: number }>;
  moves: Array<{ t0: number; t1: number; from: [number, number]; to: [number, number] }>;
  clicks: Array<{ t: number; x: number; y: number }>;
}

export interface Voice { text: string; file: string; from: number; frames: number }
export interface Part { from: number; frames: number; voice: Voice[] }
export interface EpisodePlan {
  intro: Part;
  rec: Part & { trim: number; cues: Array<{ id: string; step: string; from: number }> };
  outro: Part;
  total: number;
  capture: CaptureLog;
}

export const EPISODES = series.episodes as EpisodeDef[];
export const episode = (id: string) => EPISODES.find((e) => e.id === id)!;
export const nextEpisode = (id: string) => EPISODES[EPISODES.findIndex((e) => e.id === id) + 1];

/** Overlap between the intro card, the recording and the outro card. */
export const XFADE = 18;
const LEAD = Math.round(0.7 * FPS);
const GAP = Math.round(0.4 * FPS);
const TAIL = Math.round(1.1 * FPS);
/** How much of the recording plays before the first line is spoken. */
const PRE_ROLL = 0.9;

type Lines = Record<string, { file: string; duration: number }>;

function card(ep: EpisodeDef, kind: 'intro' | 'outro', lines: Lines, min: number): Part {
  let cursor = LEAD;
  const voice = ep[kind].map((text, i) => {
    const clip = lines[`${ep.id}:${kind}-${i}`];
    if (!clip) throw new Error(`Narration for ${ep.id} ${kind} is missing. Run: npm run voice`);
    const frames = Math.ceil(clip.duration * FPS);
    const line = { text, file: clip.file, from: cursor, frames };
    cursor += frames + GAP;
    return line;
  });
  return { from: 0, frames: Math.max(min, cursor - GAP + TAIL), voice };
}

export function buildPlan(ep: EpisodeDef, capture: CaptureLog, lines: Lines): EpisodePlan {
  const intro = card(ep, 'intro', lines, 6 * FPS);
  const trim = Math.max(0, (capture.cues[0]?.t ?? 0) - PRE_ROLL);
  const cues = capture.cues.map((c) => {
    const def = ep.cues.find((d) => d.id === c.id);
    if (!def) throw new Error(`Capture cue ${c.id} is not in episodes.json`);
    return { id: c.id, step: def.step, from: Math.round((c.t - trim) * FPS) };
  });
  const missing = ep.cues.filter((d) => !capture.cues.some((c) => c.id === d.id)).map((d) => d.id);
  if (missing.length) throw new Error(`${ep.id} recording has no cue for: ${missing.join(', ')}. Re-run its capture.`);
  const voice = cues.map((c) => {
    const clip = lines[`${ep.id}:${c.id}`];
    return { text: ep.cues.find((d) => d.id === c.id)!.text, file: clip.file, from: c.from, frames: Math.ceil(clip.duration * FPS) };
  });
  const recFrames = Math.floor((capture.duration - trim) * FPS);
  const rec = { from: intro.frames - XFADE, frames: recFrames, voice, trim, cues };
  const outroPart = card(ep, 'outro', lines, 7 * FPS);
  const outro = { ...outroPart, from: rec.from + rec.frames - XFADE };
  return { intro, rec, outro, total: outro.from + outro.frames, capture };
}

export async function loadPlan(id: string): Promise<EpisodePlan> {
  const ep = episode(id);
  const [capture, timing] = await Promise.all([
    fetch(staticFile(`episodes/${id}/capture.json`)).then((r) => {
      if (!r.ok) throw new Error(`No recording for ${id}. Run: npm run demo:capture -- ${id}`);
      return r.json() as Promise<CaptureLog>;
    }),
    fetch(staticFile('voice/timing.json')).then((r) => r.json() as Promise<{ lines: Lines }>),
  ]);
  return buildPlan(ep, capture, timing.lines);
}

const cubic = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

interface Cam { s: number; cx: number; cy: number }
const CAMERA_MOVE = 1.05;

function target(view: CaptureLog['view'], box: Box | null, maxZoom = 1.6): Cam {
  const { width: W, height: H } = view;
  if (!box) return { s: 1, cx: W / 2, cy: H / 2 };
  const pad = 44;
  const s = Math.min(maxZoom, Math.max(1, Math.min(W / (box.width + pad * 2), H / (box.height + pad * 2))));
  const hw = W / (2 * s);
  const hh = H / (2 * s);
  return {
    s,
    cx: Math.min(W - hw, Math.max(hw, box.x + box.width / 2)),
    cy: Math.min(H - hh, Math.max(hh, box.y + box.height / 2)),
  };
}

/** Blends the visible rectangles, not zoom and centre separately, so an edge pinned at both ends stays pinned while gliding. */
const mixIn = (view: CaptureLog['view']) => (a: Cam, b: Cam, p: number): Cam => {
  const rect = (c: Cam) => ({ x: c.cx - view.width / (2 * c.s), y: c.cy - view.height / (2 * c.s), w: view.width / c.s });
  const ra = rect(a);
  const rb = rect(b);
  const x = ra.x + (rb.x - ra.x) * p;
  const y = ra.y + (rb.y - ra.y) * p;
  const w = ra.w + (rb.w - ra.w) * p;
  const s = view.width / w;
  return { s, cx: x + w / 2, cy: y + view.height / (2 * s) };
};

/** Where the camera is at recording time `t`: each focus change glides from wherever the previous one had got to. */
export function cameraAt(capture: CaptureLog, t: number): Cam {
  const mix = mixIn(capture.view);
  let from = target(capture.view, null);
  let to = from;
  let start = -Infinity;
  for (const event of capture.camera) {
    if (event.t > t) break;
    from = mix(from, to, cubic(clamp01((event.t - start) / CAMERA_MOVE)));
    to = target(capture.view, event.box, event.zoom);
    start = event.t;
  }
  return mix(from, to, cubic(clamp01((t - start) / CAMERA_MOVE)));
}

/** Pointer position at time `t`, following the same eased glide the recorder used. */
export function pointerAt(capture: CaptureLog, t: number): { x: number; y: number; visible: boolean } {
  const moves = capture.moves;
  if (!moves.length || t < moves[0].t0 - 0.4) return { x: 0, y: 0, visible: false };
  let last = moves[0];
  for (const move of moves) {
    if (move.t0 > t) break;
    last = move;
  }
  if (t < last.t0) return { x: last.from[0], y: last.from[1], visible: true };
  const p = cubic(clamp01((t - last.t0) / Math.max(0.01, last.t1 - last.t0)));
  return { x: last.from[0] + (last.to[0] - last.from[0]) * p, y: last.from[1] + (last.to[1] - last.from[1]) * p, visible: true };
}

/** Splits a narration line into caption-sized pieces, timed by length, so a subtitle is never a paragraph. */
export function captionChunks(line: Voice, maxChars = 74): Array<{ text: string; from: number; frames: number }> {
  const sentences = line.text.split(/(?<=[.?!:])\s+/).flatMap((s) => {
    if (s.length <= maxChars) return [s];
    const parts = s.split(/(?<=,)\s+/);
    const out: string[] = [];
    for (const part of parts) {
      if (out.length && (out[out.length - 1] + ' ' + part).length <= maxChars) out[out.length - 1] += ' ' + part;
      else out.push(part);
    }
    return out;
  });
  const chunks: string[] = [];
  for (const s of sentences) {
    if (chunks.length && (chunks[chunks.length - 1] + ' ' + s).length <= maxChars && chunks[chunks.length - 1].length < 28) chunks[chunks.length - 1] += ' ' + s;
    else chunks.push(s);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  let cursor = line.from;
  return chunks.map((text, i) => {
    const frames = i === chunks.length - 1 ? line.from + line.frames - cursor : Math.round((line.frames * text.length) / total);
    const chunk = { text, from: cursor, frames };
    cursor += frames;
    return chunk;
  });
}
