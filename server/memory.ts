import { createHash, randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { resolveInside } from './security';

export const MEMORY_DIR = '.agent-hq/memory';
export const LESSONS_FILE = `${MEMORY_DIR}/lessons.json`;
export const EMBEDDINGS_FILE = `${MEMORY_DIR}/embeddings.json`;
export const TEAM = 'team';
export const LESSON_KINDS = ['convention', 'pitfall', 'decision', 'preference', 'fact'] as const;
export const LESSON_SOURCES = ['qa', 'mentor', 'verification', 'reflection', 'user'] as const;
export type LessonKind = (typeof LESSON_KINDS)[number];
export type LessonSource = (typeof LESSON_SOURCES)[number];

const MAX_TEXT = 500;
const MAX_LESSONS = 2000;

export interface Lesson {
  id: string;
  /** The agent the lesson belongs to, or "team" for lessons every agent uses. */
  agentId: string;
  kind: LessonKind;
  text: string;
  source: LessonSource;
  runId?: string;
  taskId?: string;
  createdAt: number;
  updatedAt: number;
  /** How many times the same lesson was learned again. */
  reinforced: number;
  /** How many prompts included this lesson. */
  uses: number;
  lastUsedAt?: number;
  pinned?: boolean;
}

export interface LessonInput {
  agentId: string;
  kind?: string;
  text: string;
  source?: string;
  runId?: string;
  taskId?: string;
  pinned?: boolean;
}

export class MemoryError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ------------------------------------------------------------------ storage

function memoryPath(root: string, rel: string): string {
  const full = resolveInside(root, rel);
  if (!full) throw new MemoryError(400, 'The project memory folder must stay inside the project.');
  return full;
}

const isId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,120}$/.test(v);

function cleanText(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT) : '';
}

function sanitize(raw: unknown): Lesson | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  const text = cleanText(v.text);
  if (!isId(v.id) || !isId(v.agentId) || !text) return null;
  const num = (x: unknown, fallback: number) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.floor(x) : fallback);
  const created = num(v.createdAt, Date.now());
  return {
    id: v.id,
    agentId: v.agentId,
    kind: (LESSON_KINDS as readonly string[]).includes(String(v.kind)) ? (v.kind as LessonKind) : 'fact',
    text,
    source: (LESSON_SOURCES as readonly string[]).includes(String(v.source)) ? (v.source as LessonSource) : 'user',
    ...(isId(v.runId) ? { runId: v.runId } : {}),
    ...(isId(v.taskId) ? { taskId: v.taskId } : {}),
    createdAt: created,
    updatedAt: num(v.updatedAt, created),
    reinforced: num(v.reinforced, 0),
    uses: num(v.uses, 0),
    ...(typeof v.lastUsedAt === 'number' ? { lastUsedAt: num(v.lastUsedAt, 0) } : {}),
    ...(v.pinned === true ? { pinned: true } : {}),
  };
}

export function loadLessons(root: string): Lesson[] {
  const file = memoryPath(root, LESSONS_FILE);
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new MemoryError(422, `${LESSONS_FILE} is not valid JSON. Fix or delete the file; Agent HQ will not overwrite it.`);
  }
  const list = Array.isArray(parsed) ? parsed : Array.isArray((parsed as { lessons?: unknown })?.lessons) ? (parsed as { lessons: unknown[] }).lessons : null;
  if (!list) throw new MemoryError(422, `${LESSONS_FILE} has no "lessons" list. Fix or delete the file; Agent HQ will not overwrite it.`);
  const seen = new Set<string>();
  return list.map(sanitize).filter((l): l is Lesson => Boolean(l) && !seen.has(l!.id) && Boolean(seen.add(l!.id)));
}

function writeAtomic(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);
}

export function saveLessons(root: string, lessons: Lesson[]) {
  const file = memoryPath(root, LESSONS_FILE);
  writeAtomic(file, JSON.stringify({ version: 1, lessons: lessons.slice(-MAX_LESSONS) }, null, 2) + '\n');
  const ignore = path.join(path.dirname(file), '.gitignore');
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '# Search index, rebuilt automatically\nembeddings.json\n', 'utf8');
}

// ------------------------------------------------------------------ text

const STOP = new Set(
  'a all also an and any are as at be been but by can could do does each every for from get got has have how if in into is it its just like make may more most must need new not of on one only or other please should so some sure than that the their them then there these they thing things this to use used uses using very want was way were what when where which while will with without would you your we our'.split(' ')
);

function stem(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

export function tokenize(text: string): string[] {
  const words = text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .normalize('NFKC')
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.filter((w) => w.length > 1 && !STOP.has(w)).map(stem);
}

function similarity(a: string, b: string): number {
  const x = new Set(tokenize(a));
  const y = new Set(tokenize(b));
  if (!x.size || !y.size) return a.trim().toLowerCase() === b.trim().toLowerCase() ? 1 : 0;
  let both = 0;
  for (const t of x) if (y.has(t)) both++;
  return both / (x.size + y.size - both);
}

export function textHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

// ------------------------------------------------------------------ edits

export function addLessons(root: string, inputs: LessonInput[], now = Date.now()): { added: Lesson[]; reinforced: Lesson[] } {
  const lessons = loadLessons(root);
  const added: Lesson[] = [];
  const reinforced: Lesson[] = [];
  for (const input of inputs.slice(0, 50)) {
    const text = cleanText(input.text);
    if (!text || !isId(input.agentId)) continue;
    const same = lessons.find((l) => l.agentId === input.agentId && (similarity(l.text, text) >= 0.6 || l.text.toLowerCase() === text.toLowerCase()));
    if (same) {
      same.reinforced += 1;
      same.updatedAt = now;
      if (text.length > same.text.length && input.source === 'user') same.text = text;
      if (!reinforced.includes(same)) reinforced.push(same);
      continue;
    }
    const lesson = sanitize({
      ...input,
      text,
      id: `lsn-${randomUUID().slice(0, 12)}`,
      createdAt: now,
      updatedAt: now,
      reinforced: 0,
      uses: 0,
    })!;
    lessons.push(lesson);
    added.push(lesson);
  }
  if (added.length || reinforced.length) saveLessons(root, lessons);
  return { added, reinforced };
}

export function updateLesson(root: string, id: string, patch: Record<string, unknown>): Lesson {
  const lessons = loadLessons(root);
  const lesson = lessons.find((l) => l.id === id);
  if (!lesson) throw new MemoryError(404, 'That lesson no longer exists.');
  if (patch.text !== undefined) {
    const text = cleanText(patch.text);
    if (!text) throw new MemoryError(400, 'A lesson needs some text.');
    lesson.text = text;
  }
  if (patch.kind !== undefined) {
    if (!(LESSON_KINDS as readonly string[]).includes(String(patch.kind))) throw new MemoryError(400, 'Unknown lesson kind.');
    lesson.kind = patch.kind as LessonKind;
  }
  if (patch.agentId !== undefined) {
    if (!isId(patch.agentId)) throw new MemoryError(400, 'Unknown agent.');
    lesson.agentId = patch.agentId;
  }
  if (patch.pinned !== undefined) {
    if (patch.pinned) lesson.pinned = true;
    else delete lesson.pinned;
  }
  lesson.updatedAt = Date.now();
  saveLessons(root, lessons);
  return lesson;
}

export function deleteLesson(root: string, id: string): void {
  const lessons = loadLessons(root);
  const next = lessons.filter((l) => l.id !== id);
  if (next.length !== lessons.length) saveLessons(root, next);
}

// ------------------------------------------------------------------ search

export interface Embedder {
  model: string;
  embed(texts: string[], purpose: 'query' | 'document'): Promise<number[][]>;
}

export interface SearchHit {
  lesson: Lesson;
  score: number;
  matchedBy: Array<'keyword' | 'meaning'>;
}

export interface SearchResult {
  hits: SearchHit[];
  mode: 'keyword' | 'hybrid';
  embeddingModel?: string;
  embeddingError?: string;
}

export function bm25(query: string, docs: Lesson[]): Map<string, number> {
  const q = [...new Set(tokenize(query))];
  const scores = new Map<string, number>();
  if (!q.length || !docs.length) return scores;
  const tokens = docs.map((d) => tokenize(`${d.text} ${d.kind}`));
  const avg = tokens.reduce((n, t) => n + t.length, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const t of tokens) for (const w of new Set(t)) df.set(w, (df.get(w) ?? 0) + 1);
  docs.forEach((doc, i) => {
    let score = 0;
    for (const term of q) {
      const tf = tokens[i].filter((w) => w === term).length;
      if (!tf) continue;
      const n = df.get(term) ?? 0;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      score += idf * ((tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (tokens[i].length / avg))));
    }
    if (score > 0) scores.set(doc.id, score);
  });
  return scores;
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

interface VectorCache {
  model: string;
  vectors: Record<string, { hash: string; v: number[] }>;
}

function loadVectors(root: string, model: string): VectorCache {
  try {
    const raw = JSON.parse(fs.readFileSync(memoryPath(root, EMBEDDINGS_FILE), 'utf8')) as VectorCache;
    if (raw?.model === model && raw.vectors && typeof raw.vectors === 'object') return raw;
  } catch {
    // A missing or unreadable index is rebuilt.
  }
  return { model, vectors: {} };
}

/** Embeds lessons that have no current vector, saves the index, and returns vectors by lesson id. */
export async function indexLessons(root: string, lessons: Lesson[], embedder: Embedder): Promise<Map<string, number[]>> {
  const cache = loadVectors(root, embedder.model);
  const missing = lessons.filter((l) => cache.vectors[l.id]?.hash !== textHash(l.text));
  for (let i = 0; i < missing.length; i += 32) {
    const batch = missing.slice(i, i + 32);
    const vectors = await embedder.embed(batch.map((l) => l.text), 'document');
    if (vectors.length !== batch.length) throw new Error('The embedding model returned the wrong number of vectors.');
    batch.forEach((l, j) => (cache.vectors[l.id] = { hash: textHash(l.text), v: vectors[j].map((x) => Math.round(x * 1e5) / 1e5) }));
  }
  const live = new Set(lessons.map((l) => l.id));
  const stale = Object.keys(cache.vectors).filter((id) => !live.has(id));
  if (missing.length || stale.length) {
    for (const id of stale) delete cache.vectors[id];
    writeAtomic(memoryPath(root, EMBEDDINGS_FILE), JSON.stringify(cache));
  }
  return new Map(lessons.map((l) => [l.id, cache.vectors[l.id].v]));
}

const RRF = 60;

/**
 * Embedding models squeeze similarities into a narrow band (Nomic: about 0.40 to 0.60 for short notes), so a
 * fixed cutoff either keeps everything or nothing. A lesson counts as a meaning match when it is close to the
 * best match and clearly above the typical similarity for this query.
 */
export function standsOut(score: number, all: number[]): boolean {
  if (score < 0.3 || !all.length) return false;
  const sorted = [...all].sort((a, b) => a - b);
  const best = sorted[sorted.length - 1];
  if (score < best - 0.05) return false;
  if (sorted.length < 3) return true;
  const mid = sorted.length / 2;
  const median = sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
  return score >= median + 0.04;
}

export async function searchLessons(
  root: string,
  candidates: Lesson[],
  query: string,
  embedder: Embedder | null,
  limit = 8
): Promise<SearchResult> {
  const keyword = [...bm25(query, candidates).entries()].sort((a, b) => b[1] - a[1]);
  const fused = new Map<string, { score: number; matchedBy: Set<'keyword' | 'meaning'> }>();
  const bump = (id: string, rank: number, by: 'keyword' | 'meaning') => {
    const entry = fused.get(id) ?? { score: 0, matchedBy: new Set() };
    entry.score += 1 / (RRF + rank);
    entry.matchedBy.add(by);
    fused.set(id, entry);
  };
  keyword.forEach(([id], rank) => bump(id, rank, 'keyword'));
  let mode: SearchResult['mode'] = 'keyword';
  let embeddingError: string | undefined;
  if (embedder && query.trim() && candidates.length) {
    try {
      const vectors = await indexLessons(root, candidates, embedder);
      const [q] = await embedder.embed([query.slice(0, 4000)], 'query');
      const scored = candidates.map((l) => [l.id, cosine(q, vectors.get(l.id) ?? [])] as const).sort((a, b) => b[1] - a[1]);
      const meaning = scored.filter(([, s]) => standsOut(s, scored.map(([, v]) => v))).slice(0, Math.max(limit * 2, 10));
      meaning.forEach(([id], rank) => bump(id, rank, 'meaning'));
      mode = 'hybrid';
    } catch (err) {
      embeddingError = (err as Error).message;
    }
  }
  const byId = new Map(candidates.map((l) => [l.id, l]));
  const hits = [...fused.entries()]
    .map(([id, f]) => {
      const lesson = byId.get(id)!;
      return { lesson, score: f.score + Math.min(lesson.reinforced, 5) * 0.001, matchedBy: [...f.matchedBy] };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return { hits, mode, ...(mode === 'hybrid' ? { embeddingModel: embedder!.model } : {}), ...(embeddingError ? { embeddingError } : {}) };
}

export function lessonsFor(lessons: Lesson[], agentId: string | undefined): Lesson[] {
  return agentId ? lessons.filter((l) => l.agentId === agentId || l.agentId === TEAM) : lessons;
}

/** Picks the lessons to put in a prompt: pinned first, then the most relevant, within a character budget. */
export async function memoryContext(
  root: string,
  args: { agentId: string; query: string; budgetChars?: number },
  embedder: Embedder | null,
  now = Date.now()
): Promise<{ lessons: Lesson[]; total: number; mode: SearchResult['mode']; embeddingError?: string }> {
  const all = loadLessons(root);
  const candidates = lessonsFor(all, args.agentId);
  if (!candidates.length) return { lessons: [], total: 0, mode: 'keyword' };
  const budget = Math.max(400, Math.min(args.budgetChars ?? 3500, 20_000));
  const result = await searchLessons(root, candidates, args.query, embedder, candidates.length);
  const rank = new Map(result.hits.map((h, i) => [h.lesson.id, i]));
  const fitsAll = candidates.reduce((n, l) => n + l.text.length + 16, 0) <= budget;
  const ordered = [...candidates]
    .filter((l) => fitsAll || l.pinned || rank.has(l.id) || result.hits.length === 0)
    .sort(
      (a, b) =>
        Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
        (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) ||
        b.reinforced - a.reinforced ||
        b.updatedAt - a.updatedAt
    );
  const chosen: Lesson[] = [];
  let used = 0;
  for (const lesson of ordered) {
    const cost = lesson.text.length + 16;
    if (used + cost > budget) continue;
    chosen.push(lesson);
    used += cost;
  }
  if (chosen.length) {
    const ids = new Set(chosen.map((l) => l.id));
    for (const l of all) {
      if (!ids.has(l.id)) continue;
      l.uses += 1;
      l.lastUsedAt = now;
    }
    saveLessons(root, all);
  }
  return { lessons: chosen, total: candidates.length, mode: result.mode, ...(result.embeddingError ? { embeddingError: result.embeddingError } : {}) };
}
