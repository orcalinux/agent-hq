import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { expect, type CDPSession, type Locator, type Page } from '@playwright/test';

/**
 * Records one tutorial episode from the running app.
 *
 * The narration is generated first (demo/scripts/voice.mjs), so the recording is paced by it: `say(cue)` waits until
 * the previous line has been spoken, marks the moment the next line starts, and the actions that follow happen while
 * it is heard. Frames come from Chromium's screencast at the page's device scale, then ffmpeg encodes them to a
 * constant 30 fps master. Camera focus, cursor moves and clicks are logged so the video can zoom and draw a cursor.
 */
export const VIEW = { width: 1440, height: 810 };
export const SCALE = 2;
const GAP = 0.45;
const TAIL = 1.2;

/** Text that must never be on screen in a published video: this account's user name, and the computer's name as a shell prompt shows it. */
const PRIVATE = [os.userInfo().username, `@${os.hostname().split('.')[0]}`].filter((word) => word.length >= 3);

export type Box = { x: number; y: number; width: number; height: number };
interface Timing { lines: Record<string, { file: string; duration: number }> }
interface Frame { file: string; t: number }

export interface CaptureLog {
  episode: string;
  view: typeof VIEW;
  start: number;
  duration: number;
  cues: Array<{ id: string; t: number }>;
  camera: Array<{ t: number; box: Box | null; zoom?: number }>;
  moves: Array<{ t0: number; t1: number; from: [number, number]; to: [number, number] }>;
  clicks: Array<{ t: number; x: number; y: number }>;
}

const ease = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

/** Width of a baseline JPEG, read from its SOF0 marker. */
const jpegWidth = (data: Buffer) => {
  const sof = data.indexOf(Buffer.from([0xff, 0xc0]));
  return sof < 0 ? 0 : data.readUInt16BE(sof + 7);
};

export class Recorder {
  readonly dir: string;
  private readonly frameDir: string;
  private readonly timing: Timing;
  private cdp?: CDPSession;
  private frames: Frame[] = [];
  private firstWidth = 0;
  private clockOffset: number | null = null;
  private t0 = 0;
  private readyAt = 0;
  private pointer: [number, number] = [VIEW.width * 0.62, VIEW.height * 0.55];
  private log: CaptureLog;

  constructor(private readonly page: Page, readonly episode: string) {
    this.dir = path.resolve('demo/public/episodes', episode);
    this.frameDir = path.join(this.dir, 'frames');
    const timingFile = path.resolve('demo/public/voice/timing.json');
    if (!fs.existsSync(timingFile)) throw new Error('Narration is missing. Run: (cd demo && npm run voice)');
    this.timing = JSON.parse(fs.readFileSync(timingFile, 'utf8'));
    this.log = { episode, view: VIEW, start: 0, duration: 0, cues: [], camera: [], moves: [], clicks: [] };
  }

  private now() {
    return Date.now() / 1000 - this.t0;
  }

  private duration(cue: string) {
    const line = this.timing.lines[`${this.episode}:${cue}`];
    if (!line) throw new Error(`No narration for ${this.episode}:${cue}. Run: (cd demo && npm run voice)`);
    return line.duration;
  }

  async start() {
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.frameDir, { recursive: true });
    await this.page.addStyleTag({ content: '*, *::before, *::after { cursor: none !important; caret-color: #6aa3ff; }' });
    this.cdp = await this.page.context().newCDPSession(this.page);
    this.cdp.on('Page.screencastFrame', (event) => {
      const received = Date.now() / 1000;
      const stamp = event.metadata.timestamp;
      if (this.clockOffset === null) this.clockOffset = stamp && Math.abs(received - stamp) < 2 ? received - stamp : 0;
      const t = (stamp ? stamp + this.clockOffset : received) - this.t0;
      const file = `${String(this.frames.length).padStart(6, '0')}.jpg`;
      const data = Buffer.from(event.data, 'base64');
      if (this.frames.length === 0) this.firstWidth = jpegWidth(data);
      fs.writeFileSync(path.join(this.frameDir, file), data);
      this.frames.push({ file, t });
      void this.cdp?.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => undefined);
    });
    this.t0 = Date.now() / 1000;
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: VIEW.width * SCALE, maxHeight: VIEW.height * SCALE, everyNthFrame: 1 });
    await this.page.mouse.move(...this.pointer);
    await this.hold(0.6);
    this.readyAt = this.now();
  }

  /** Waits for the previous line to finish, then starts narrating `cue`. */
  async say(cue: string) {
    const wait = this.readyAt - this.now();
    if (wait > 0) await this.page.waitForTimeout(wait * 1000);
    await this.assertPrivate(cue);
    const t = this.now();
    this.log.cues.push({ id: cue, t });
    this.readyAt = t + this.duration(cue) + GAP;
  }

  /** Fails the recording if anything on screen, terminal rows and field values included, shows a private word. */
  private async assertPrivate(where: string) {
    const text = await this.page.evaluate(() => {
      const fields = Array.from(document.querySelectorAll('input, textarea')).map((el) => (el as HTMLInputElement).value);
      return [document.body.textContent ?? '', ...fields].join('\n').toLowerCase();
    });
    for (const word of PRIVATE) {
      if (text.includes(word.toLowerCase())) throw new Error(`"${word}" is visible at "${where}" in ${this.episode}. Keep personal names off screen.`);
    }
  }

  /** Waits until the current line has finished, for actions that should land after it. */
  async settle(extra = 0) {
    const wait = this.readyAt - this.now() + extra;
    if (wait > 0) await this.page.waitForTimeout(wait * 1000);
  }

  async hold(seconds: number) {
    await this.page.waitForTimeout(seconds * 1000);
  }

  /** Points the camera at a region (or back to the whole window with null). `zoom` caps how far it may zoom in. */
  async camera(target: Locator | Box | null, zoom?: number) {
    let box: Box | null = null;
    if (target && 'boundingBox' in target) {
      await target.first().scrollIntoViewIfNeeded().catch(() => undefined);
      const b = await target.first().boundingBox();
      box = b ? { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) } : null;
    } else if (target) box = target as Box;
    this.log.camera.push({ t: this.now(), box, zoom });
  }

  /** Glides the pointer to the middle of `target` with an ease, like a person moving a mouse. */
  async moveTo(target: Locator, offset?: { x: number; y: number }) {
    const el = target.first();
    await expect(el).toBeVisible();
    await el.scrollIntoViewIfNeeded();
    const b = (await el.boundingBox())!;
    const to: [number, number] = offset ? [b.x + offset.x, b.y + offset.y] : [b.x + b.width / 2, b.y + b.height / 2];
    const from = this.pointer;
    const distance = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (distance < 2) return;
    const ms = Math.min(900, Math.max(380, 260 + distance * 0.55));
    const t0 = this.now();
    const steps = Math.round(ms / 16);
    for (let i = 1; i <= steps; i++) {
      const p = ease(i / steps);
      await this.page.mouse.move(from[0] + (to[0] - from[0]) * p, from[1] + (to[1] - from[1]) * p);
      await this.page.waitForTimeout(ms / steps - 4);
    }
    this.log.moves.push({ t0, t1: this.now(), from, to });
    this.pointer = to;
  }

  async click(target: Locator, opts: { offset?: { x: number; y: number }; pause?: number } = {}) {
    await this.moveTo(target, opts.offset);
    await this.hold(opts.pause ?? 0.18);
    this.log.clicks.push({ t: this.now(), x: this.pointer[0], y: this.pointer[1] });
    await this.page.mouse.down();
    await this.page.waitForTimeout(70);
    await this.page.mouse.up();
    await this.hold(0.25);
  }

  /** Clicks a field and types into it at a readable pace. */
  async type(target: Locator, text: string, delay = 42) {
    await this.click(target);
    await target.first().pressSequentially(text, { delay });
  }

  /** Opens one of the app's custom pickers and chooses an option, with the pointer doing both clicks. */
  async pick(label: string, option: string | RegExp, scope: Locator | Page = this.page) {
    await this.click(scope.getByRole('button', { name: label, exact: true }));
    await this.hold(0.35);
    await this.click(this.page.getByRole('option', typeof option === 'string' ? { name: option, exact: true } : { name: option }));
  }

  /** Lets the last line finish, stops the screencast and encodes the master recording. */
  async finish() {
    await this.settle(TAIL);
    await this.assertPrivate('the end');
    await this.cdp?.send('Page.stopScreencast');
    await this.page.waitForTimeout(150);
    const end = this.now();
    if (this.frames.length < 10) throw new Error(`Only ${this.frames.length} frames were captured`);
    if (this.firstWidth < VIEW.width * SCALE) {
      throw new Error(`Frames arrived ${this.firstWidth}px wide, not ${VIEW.width * SCALE}px. Run recordings with playwright.demo.config.ts, which starts Chromium at --force-device-scale-factor=${SCALE}.`);
    }
    const frames = this.frames.filter((f) => f.t >= 0).sort((a, b) => a.t - b.t);
    const lines = ['ffconcat version 1.0'];
    frames.forEach((frame, i) => {
      const from = i === 0 ? 0 : frame.t;
      const to = frames[i + 1]?.t ?? end;
      lines.push(`file 'frames/${frame.file}'`, `duration ${Math.max(0.001, to - from).toFixed(4)}`);
    });
    lines.push(`file 'frames/${frames.at(-1)!.file}'`);
    fs.writeFileSync(path.join(this.dir, 'frames.ffconcat'), lines.join('\n') + '\n');
    const size = `${VIEW.width * SCALE}:${VIEW.height * SCALE}`;
    const encode = spawnSync('ffmpeg', [
      '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', 'frames.ffconcat',
      '-vf', `scale=${size}:flags=lanczos:force_original_aspect_ratio=decrease,pad=${size}:(ow-iw)/2:(oh-ih)/2:color=0x0d0e11,fps=30,format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '12', '-tune', 'stillimage', '-movflags', '+faststart', 'recording.mp4',
    ], { cwd: this.dir, encoding: 'utf8' });
    if (encode.status !== 0) throw new Error(`ffmpeg could not encode the recording: ${encode.stderr}`);
    this.log.duration = end;
    fs.writeFileSync(path.join(this.dir, 'capture.json'), JSON.stringify(this.log, null, 2));
    if (!process.env.DEMO_KEEP_FRAMES) fs.rmSync(this.frameDir, { recursive: true, force: true });
    fs.rmSync(path.join(this.dir, 'frames.ffconcat'), { force: true });
  }
}
