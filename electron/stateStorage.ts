import fs from 'node:fs';
import path from 'node:path';

const KEYS = new Set(['agent-hq.state', 'agent-hq.connections', 'agent-hq.workspace', 'agent-hq.layout', 'agent-hq.model-watch', 'agent-hq.magpie-routing']);
const MAX_BYTES = 16 * 1024 * 1024;
type Entry = { origin: string; value: string | null };

export function createStateStorage(directory: string) {
  const entries = new Map<string, Entry | null>();
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fileFor = (key: string) => path.join(directory, `${key}.json`);
  const load = (key: string): Entry | null => {
    if (entries.has(key)) return entries.get(key)!;
    let entry: Entry | null = null;
    try {
      const file = fileFor(key);
      if (fs.statSync(file).size <= MAX_BYTES) {
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (typeof saved.origin === 'string' && (saved.value === null || typeof saved.value === 'string')) entry = saved;
      }
    } catch {
      entry = null;
    }
    entries.set(key, entry);
    return entry;
  };
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    for (const key of pending) {
      try {
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        const file = fileFor(key);
        const temporary = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify(entries.get(key)), { mode: 0o600 });
        fs.renameSync(temporary, file);
        pending.delete(key);
      } catch (error) {
        console.error('[Agent HQ] Could not save desktop state:', error);
      }
    }
  };
  return {
    read(key: string, origin: string): { restore: boolean; value: string | null } {
      const entry = KEYS.has(key) ? load(key) : null;
      return { restore: !!entry && entry.origin !== origin, value: entry?.value ?? null };
    },
    write(key: string, origin: string, value: unknown): boolean {
      if (!KEYS.has(key) || (value !== null && typeof value !== 'string')) return false;
      const entry = { origin, value } as Entry;
      if (Buffer.byteLength(JSON.stringify(entry)) > MAX_BYTES) return false;
      const previous = load(key);
      if (previous?.origin === origin && previous.value === value) return true;
      entries.set(key, entry);
      pending.add(key);
      timer ??= setTimeout(flush, 500);
      return true;
    },
    flush,
  };
}
