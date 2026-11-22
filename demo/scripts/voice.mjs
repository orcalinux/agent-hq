import { spawnSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Narrates the overview (src/scenes.json) and every tutorial episode (src/series/episodes.json) with Edge's free neural
 * voices (edge-tts), and records each clip's length in public/voice/timing.json. Clips are cached by text and voice.
 */
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const script = JSON.parse(fs.readFileSync(path.join(root, 'src/scenes.json'), 'utf8'));
const series = JSON.parse(fs.readFileSync(path.join(root, 'src/series/episodes.json'), 'utf8'));
const outDir = path.join(root, 'public/voice');
const voice = process.env.DEMO_VOICE || script.voice;
const rate = process.env.DEMO_RATE || script.rate || '+0%';
fs.mkdirSync(outDir, { recursive: true });

if (spawnSync('edge-tts', ['--help'], { stdio: 'ignore' }).error) {
  console.error('edge-tts is not installed. Install it with:  uv tool install edge-tts   (or: pipx install edge-tts)');
  process.exit(1);
}

const duration = (file) => {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  return Number.parseFloat(r.stdout.trim());
};

function speak(text, file) {
  return new Promise((resolve, reject) => {
    const child = spawn('edge-tts', ['--voice', voice, `--rate=${rate}`, '--text', text, '--write-media', file], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => (code === 0 && fs.statSync(file).size > 0 ? resolve() : reject(new Error(err.trim().split('\n').at(-1) || `exit ${code}`))));
  });
}

async function clip(text) {
  const name = createHash('sha256').update(`${voice}\0${rate}\0${text}`).digest('hex').slice(0, 16) + '.mp3';
  const file = path.join(outDir, name);
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) {
    for (let attempt = 1; ; attempt++) {
      try {
        await speak(text, file);
        break;
      } catch (e) {
        if (attempt === 10) throw new Error(`Could not narrate "${text}": ${e.message}`);
        await new Promise((r) => setTimeout(r, attempt * 4000));
      }
    }
  }
  return { file: `voice/${name}`, duration: duration(file) };
}

const jobs = [
  ...script.scenes.flatMap((scene) => scene.lines.map((text, i) => ({ key: `${scene.id}:${i}`, text }))),
  ...series.episodes.flatMap((ep) => [
    ...ep.intro.map((text, i) => ({ key: `${ep.id}:intro-${i}`, text })),
    ...ep.cues.map((cue) => ({ key: `${ep.id}:${cue.id}`, text: cue.text })),
    ...ep.outro.map((text, i) => ({ key: `${ep.id}:outro-${i}`, text })),
  ]),
];
if (new Set(jobs.map((j) => j.key)).size !== jobs.length) throw new Error('Two narration lines share an id');
const results = new Map();
let next = 0;
let done = 0;
async function worker() {
  while (next < jobs.length) {
    const job = jobs[next++];
    results.set(job.key, await clip(job.text));
    process.stdout.write(`\rNarrated ${++done}/${jobs.length} lines`);
  }
}
await Promise.all(Array.from({ length: 2 }, worker));

const timing = {
  voice,
  rate,
  scenes: Object.fromEntries(script.scenes.map((s) => [s.id, s.lines.map((_, i) => results.get(`${s.id}:${i}`))])),
  lines: Object.fromEntries(jobs.filter((j) => !script.scenes.some((s) => j.key.startsWith(`${s.id}:`))).map((j) => [j.key, results.get(j.key)])),
};
fs.writeFileSync(path.join(outDir, 'timing.json'), JSON.stringify(timing, null, 2));
const total = [...results.values()].reduce((sum, l) => sum + l.duration, 0);
console.log(`\nVoice ready: ${jobs.length} lines, ${Math.round(total)}s of narration (${voice}).`);
