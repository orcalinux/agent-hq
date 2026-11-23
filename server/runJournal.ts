import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { configDir } from './config';

const MAX_BYTES = 4 * 1024 * 1024;

function journalFile(workspace: string): string {
  const id = crypto.createHash('sha256').update(path.resolve(workspace)).digest('hex').slice(0, 16);
  return path.join(configDir(), 'runs', `${id}.json`);
}

export function saveJournal(workspace: string, mission: unknown): void {
  const body = JSON.stringify({ savedAt: new Date().toISOString(), workspace: path.resolve(workspace), mission });
  if (Buffer.byteLength(body) > MAX_BYTES) throw new Error('The run journal is too large to save.');
  const file = journalFile(workspace);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, body, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function loadJournal(workspace: string): { savedAt: string; mission: unknown } | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(journalFile(workspace), 'utf8'));
    return parsed && typeof parsed === 'object' && parsed.mission ? { savedAt: String(parsed.savedAt), mission: parsed.mission } : null;
  } catch {
    return null;
  }
}

export function clearJournal(workspace: string): void {
  fs.rmSync(journalFile(workspace), { force: true });
}
