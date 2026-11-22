import { spawnSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Narrates every line of src/scenes.json with Edge's free neural voices (edge-tts) and records each clip's length. */
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const script = JSON.parse(fs.readFileSync(path.join(root, 'src/scenes.json'), 'utf8'));
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
        if (attempt === 8) throw new Error(`Could not narrate "${text}": ${e.message}`);
        await new Promise((r) => setTimeout(r, attempt * 2000));
      }
    }
  }
  return { file: `voice/${name}`, duration: duration(file) };
}

const jobs = script.scenes.flatMap((scene) => scene.lines.map((text, i) => ({ scene: scene.id, i, text })));
const results = new Map();
let next = 0;
let done = 0;
async function worker() {
  while (next < jobs.length) {
    const job = jobs[next++];
    results.set(`${job.scene}:${job.i}`, await clip(job.text));
    process.stdout.write(`\rNarrated ${++done}/${jobs.length} lines`);
  }
}
await Promise.all(Array.from({ length: 2 }, worker));

const timing = { voice, rate, scenes: Object.fromEntries(script.scenes.map((s) => [s.id, s.lines.map((_, i) => results.get(`${s.id}:${i}`))])) };
fs.writeFileSync(path.join(outDir, 'timing.json'), JSON.stringify(timing, null, 2));
const total = Object.values(timing.scenes).flat().reduce((sum, l) => sum + l.duration, 0);
console.log(`\nVoice ready: ${jobs.length} lines, ${Math.round(total)}s of narration (${voice}).`);
