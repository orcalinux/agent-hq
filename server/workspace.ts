import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { resolveInside } from './security';

export interface TreeEntry {
  path: string;
  name: string;
  type: 'file' | 'directory';
  size?: number;
}

const IGNORED = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache', 'coverage', 'test-results', '.venv', '__pycache__']);
const MAX_ENTRIES = 5000;

export function scanTree(root: string, maxDepth = 8): { entries: TreeEntry[]; truncated: boolean } {
  const entries: TreeEntry[] = [];
  let truncated = false;
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth || truncated) return;
    let items: fs.Dirent[];
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    items.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const item of items) {
      if (IGNORED.has(item.name) || item.isSymbolicLink()) continue;
      if (entries.length >= MAX_ENTRIES) {
        truncated = true;
        return;
      }
      const full = path.join(dir, item.name);
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (item.isDirectory()) {
        entries.push({ path: rel, name: item.name, type: 'directory' });
        walk(full, depth + 1);
      } else if (item.isFile()) {
        let size: number | undefined;
        try {
          size = fs.statSync(full).size;
        } catch {
          size = undefined;
        }
        entries.push({ path: rel, name: item.name, type: 'file', size });
      }
    }
  };
  walk(root, 0);
  return { entries, truncated };
}

const MAX_READ_BYTES = 2 * 1024 * 1024;

export function readFile(root: string, rel: string): { content: string; size: number; binary: boolean } {
  const full = resolveInside(root, rel);
  if (!full || !fs.existsSync(full) || !fs.statSync(full).isFile()) throw new Error('File not found in workspace.');
  const size = fs.statSync(full).size;
  if (size > MAX_READ_BYTES) throw new Error(`File is too large to open (${(size / 1024 / 1024).toFixed(1)} MB).`);
  const buf = fs.readFileSync(full);
  const binary = buf.subarray(0, 8000).includes(0);
  return { content: binary ? '' : buf.toString('utf8'), size, binary };
}

export function writeFile(root: string, rel: string, content: string, opts: { overwrite: boolean }): { size: number; created: boolean } {
  const full = resolveInside(root, rel);
  if (!full) throw new Error('Path must be inside the workspace.');
  const exists = fs.existsSync(full);
  if (exists && !opts.overwrite) throw new Error(`${rel} already exists.`);
  if (exists && !fs.statSync(full).isFile()) throw new Error(`${rel} is not a file.`);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return { size: Buffer.byteLength(content), created: !exists };
}

export function gitStatus(root: string): Promise<{
  isRepo: boolean;
  branch?: string;
  files: Array<{ path: string; status: string; additions?: number; deletions?: number }>;
  error?: string;
}> {
  const git = (args: string[]) =>
    new Promise<{ code: number; out: string; err: string }>((resolve) =>
      execFile('git', args, { cwd: root, timeout: 8000, maxBuffer: 8 * 1024 * 1024 }, (e, out, err) =>
        resolve({ code: e ? 1 : 0, out: String(out), err: String(err) })
      )
    );
  return (async () => {
    const inside = await git(['rev-parse', '--is-inside-work-tree']);
    if (inside.code !== 0) return { isRepo: false, files: [] };
    const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).out.trim();
    const status = await git(['status', '--porcelain=v1']);
    const numstat = await git(['diff', 'HEAD', '--numstat']);
    const stats = new Map<string, { a: number; d: number }>();
    for (const line of numstat.out.split('\n')) {
      const [a, d, p] = line.split('\t');
      if (p) stats.set(p, { a: Number(a) || 0, d: Number(d) || 0 });
    }
    const files = status.out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const code = line.slice(0, 2).trim() || '?';
        const p = line.slice(3).split(' -> ').pop() || '';
        const s = stats.get(p);
        return { path: p, status: code, additions: s?.a, deletions: s?.d };
      });
    return { isRepo: true, branch, files };
  })();
}
