import script from './scenes.json';
import timingJson from '../public/voice/timing.json';
import { FPS } from './theme';

export type Action = 'click' | 'point';
export interface Step { shot: string; at: number; action?: Action; zoom?: boolean }
export interface SceneDef { id: string; kind: 'title' | 'flow' | 'team' | 'shots' | 'ladder' | 'outro'; chapter?: string; lines: string[]; steps?: Step[] }
export interface Line { text: string; file: string; from: number; frames: number }
export interface Scene extends SceneDef { frames: number; lines: string[]; voice: Line[] }

const timing = timingJson as { scenes: Record<string, Array<{ file: string; duration: number }>> };

export const LEAD = Math.round(0.55 * FPS);
export const GAP = Math.round(0.32 * FPS);
export const TAIL = Math.round(0.8 * FPS);
export const TRANSITION = 14;

/** Lays every scene out on the narration: each line starts after the previous one ends, plus a short breath. */
export const scenes: Scene[] = (script.scenes as SceneDef[]).map((def) => {
  const clips = timing.scenes[def.id];
  if (!clips || clips.length !== def.lines.length) throw new Error(`Narration for "${def.id}" is missing or stale. Run: npm run voice`);
  let cursor = LEAD;
  const voice = def.lines.map((text, i) => {
    const frames = Math.ceil(clips[i].duration * FPS);
    const line = { text, file: clips[i].file, from: cursor, frames };
    cursor += frames + GAP;
    return line;
  });
  return { ...def, voice, frames: cursor - GAP + TAIL };
});

export const totalFrames = scenes.reduce((sum, s) => sum + s.frames, 0) - TRANSITION * (scenes.length - 1);

/** Frame at which line `i` starts, or the scene end for i past the last line. */
export const lineStart = (scene: Scene, i: number) => (i < scene.voice.length ? scene.voice[i].from : scene.frames);
