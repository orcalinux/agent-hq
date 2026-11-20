import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addLessons,
  bm25,
  deleteLesson,
  EMBEDDINGS_FILE,
  LESSONS_FILE,
  loadLessons,
  memoryContext,
  searchLessons,
  standsOut,
  tokenize,
  updateLesson,
  type Embedder,
  type Lesson,
} from '../../server/memory';
import { chooseEmbeddingModel, isEmbeddingModel, ollamaEmbedder, pullModel } from '../../server/embeddings';

process.env.AGENT_HQ_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hq-memory-config-'));

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hq-memory-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const file = () => path.join(root, LESSONS_FILE);

/** Maps texts onto topic axes so "meaning" is predictable in tests. */
function fakeEmbedder(calls: string[][] = []): Embedder {
  const axes = [/style|css|tailwind|colou?r|theme/i, /test|vitest|spec/i, /database|sql|migration/i];
  return {
    model: 'fake-embed',
    async embed(texts) {
      calls.push(texts);
      return texts.map((t) => axes.map((a) => (a.test(t) ? 1 : 0)).concat(0.01));
    },
  };
}

describe('project memory storage', () => {
  it('saves lessons in the project and keeps the search index out of git', () => {
    const { added } = addLessons(root, [{ agentId: 'agent-frontend', kind: 'convention', text: '  Use   the shared Button component ', source: 'user' }], 1000);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ agentId: 'agent-frontend', kind: 'convention', text: 'Use the shared Button component', source: 'user', reinforced: 0, uses: 0, createdAt: 1000 });
    expect(JSON.parse(fs.readFileSync(file(), 'utf8')).version).toBe(1);
    expect(fs.readFileSync(path.join(root, '.agent-hq/memory/.gitignore'), 'utf8')).toContain('embeddings.json');
    expect(loadLessons(root)).toEqual(added);
  });

  it('confirms a repeated lesson instead of storing it twice, per agent', () => {
    addLessons(root, [{ agentId: 'agent-backend', kind: 'pitfall', text: 'Validate request bodies before writing to the database', source: 'qa' }]);
    const again = addLessons(root, [
      { agentId: 'agent-backend', kind: 'pitfall', text: 'validate request bodies before writing to the database.', source: 'reflection' },
      { agentId: 'agent-frontend', kind: 'pitfall', text: 'Validate request bodies before writing to the database', source: 'qa' },
    ]);
    expect(again.added.map((l) => l.agentId)).toEqual(['agent-frontend']);
    expect(again.reinforced).toHaveLength(1);
    expect(loadLessons(root).find((l) => l.agentId === 'agent-backend')?.reinforced).toBe(1);
  });

  it('drops invalid input, unknown kinds and sources, and over-long text', () => {
    const { added } = addLessons(root, [
      { agentId: '../etc', text: 'x' },
      { agentId: 'agent-qa', text: '   ' },
      { agentId: 'agent-qa', kind: 'secret', source: 'internet', text: 'a'.repeat(900) },
    ]);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ kind: 'fact', source: 'user' });
    expect(added[0].text).toHaveLength(500);
  });

  it('refuses to overwrite a memory file it cannot read', () => {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), '{ broken');
    expect(() => loadLessons(root)).toThrow(/not valid JSON/);
    expect(() => addLessons(root, [{ agentId: 'team', text: 'Something worth keeping' }])).toThrow();
    expect(fs.readFileSync(file(), 'utf8')).toBe('{ broken');
  });

  it('does not follow a memory folder symlinked outside the project', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hq-outside-'));
    try {
      fs.symlinkSync(outside, path.join(root, '.agent-hq'));
      expect(() => addLessons(root, [{ agentId: 'team', text: 'Should not escape' }])).toThrow(/inside the project/);
      expect(fs.readdirSync(outside)).toEqual([]);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('edits, pins and forgets lessons', () => {
    const [lesson] = addLessons(root, [{ agentId: 'agent-qa', text: 'Run npm test before approving' }]).added;
    expect(updateLesson(root, lesson.id, { text: 'Run npm test and npx tsc before approving', pinned: true, kind: 'convention' })).toMatchObject({ pinned: true, kind: 'convention' });
    expect(() => updateLesson(root, lesson.id, { kind: 'nope' })).toThrow(/kind/);
    expect(() => updateLesson(root, lesson.id, { text: ' ' })).toThrow(/text/);
    expect(() => updateLesson(root, 'lsn-missing', {})).toThrow(/no longer exists/);
    deleteLesson(root, lesson.id);
    expect(loadLessons(root)).toEqual([]);
  });
});

describe('memory search', () => {
  const lesson = (id: string, text: string, extra: Partial<Lesson> = {}): Lesson => ({
    id, agentId: 'agent-frontend', kind: 'convention', text, source: 'user', createdAt: 1, updatedAt: 1, reinforced: 0, uses: 0, ...extra,
  });

  it('tokenizes code identifiers, plurals and non-Latin text', () => {
    expect(tokenize('Use apiClient for the Requests')).toEqual(['api', 'client', 'request']);
    expect(tokenize('استخدم المكون المشترك')).toEqual(['استخدم', 'المكون', 'المشترك']);
  });

  it('ranks rarer matching terms first with BM25', () => {
    const docs = [lesson('a', 'Components live in src/components'), lesson('b', 'Tailwind tokens live in src/index.css'), lesson('c', 'Components use Tailwind classes')];
    const scores = bm25('tailwind tokens', docs);
    expect([...scores.keys()].sort((x, y) => scores.get(y)! - scores.get(x)!)).toEqual(['b', 'c']);
    expect(bm25('', docs).size).toBe(0);
  });

  it('finds lessons by meaning when the words differ, and says which search matched', async () => {
    const docs = [lesson('style', 'Colours come from the theme tokens'), lesson('tests', 'Every feature needs a vitest spec'), lesson('db', 'Never edit applied migrations')];
    const keywordOnly = await searchLessons(root, docs, 'how should I write the CSS', null);
    expect(keywordOnly.mode).toBe('keyword');
    expect(keywordOnly.hits).toEqual([]);
    const hybrid = await searchLessons(root, docs, 'how should I write the CSS', fakeEmbedder());
    expect(hybrid.mode).toBe('hybrid');
    expect(hybrid.embeddingModel).toBe('fake-embed');
    expect(hybrid.hits[0]).toMatchObject({ lesson: { id: 'style' }, matchedBy: ['meaning'] });
    expect(hybrid.hits.map((h) => h.lesson.id)).not.toContain('db');
  });

  it('falls back to keywords when the embedding model fails', async () => {
    const broken: Embedder = { model: 'broken', embed: async () => { throw new Error('Ollama is down'); } };
    const res = await searchLessons(root, [lesson('t', 'Run vitest before pushing')], 'vitest', broken);
    expect(res).toMatchObject({ mode: 'keyword', embeddingError: 'Ollama is down' });
    expect(res.hits[0].matchedBy).toEqual(['keyword']);
  });

  it('embeds each lesson once and re-embeds only edited ones', async () => {
    const calls: string[][] = [];
    const embedder = fakeEmbedder(calls);
    const docs = [lesson('a', 'Theme tokens hold the colours'), lesson('b', 'Write a vitest spec')];
    await searchLessons(root, docs, 'css', embedder);
    await searchLessons(root, docs, 'tests', embedder);
    expect(calls.filter((c) => c.length === 2)).toHaveLength(1);
    await searchLessons(root, [docs[0], { ...docs[1], text: 'Write a vitest spec next to the file' }], 'tests', embedder);
    expect(calls.at(-2)).toEqual(['Write a vitest spec next to the file']);
    const index = JSON.parse(fs.readFileSync(path.join(root, EMBEDDINGS_FILE), 'utf8'));
    expect(Object.keys(index.vectors).sort()).toEqual(['a', 'b']);
    await searchLessons(root, [docs[0]], 'css', embedder);
    expect(Object.keys(JSON.parse(fs.readFileSync(path.join(root, EMBEDDINGS_FILE), 'utf8')).vectors)).toEqual(['a']);
  });
});

describe('prompt memory', () => {
  it('standsOut keeps a clear winner and drops the noise band', () => {
    const nomicLike = [0.58, 0.44, 0.43, 0.42, 0.41, 0.4, 0.4];
    expect(standsOut(0.58, nomicLike)).toBe(true);
    expect(standsOut(0.44, nomicLike)).toBe(false);
    expect(standsOut(0.4, nomicLike)).toBe(false);
    expect(standsOut(0.2, [0.2, 0.1, 0.1])).toBe(false);
    expect(standsOut(0.5, [])).toBe(false);
    expect(standsOut(0.5, [0.5, 0.3])).toBe(true);
  });

  it('uses the agent’s own and team lessons, never another agent’s, and counts each use', async () => {
    addLessons(root, [
      { agentId: 'agent-frontend', text: 'Use the shared Button component' },
      { agentId: 'team', text: 'The API lives under server/' },
      { agentId: 'agent-backend', text: 'Use prepared SQL statements' },
    ]);
    const ctx = await memoryContext(root, { agentId: 'agent-frontend', query: 'add a button' }, null, 5000);
    expect(ctx.lessons.map((l) => l.text).sort()).toEqual(['The API lives under server/', 'Use the shared Button component']);
    expect(ctx.total).toBe(2);
    const stored = loadLessons(root);
    expect(stored.filter((l) => l.uses === 1).map((l) => l.agentId).sort()).toEqual(['agent-frontend', 'team']);
    expect(stored.find((l) => l.agentId === 'agent-frontend')?.lastUsedAt).toBe(5000);
    expect((await memoryContext(root, { agentId: 'agent-nobody', query: 'x' }, null)).lessons.map((l) => l.agentId)).toEqual(['team']);
  });

  it('keeps pinned lessons and the most relevant ones when memory exceeds the budget', async () => {
    const filler = Array.from({ length: 40 }, (_, i) => ({ agentId: 'agent-frontend', text: `Unrelated note number ${i} about topic${i} and widget${i} handling` }));
    addLessons(root, [...filler, { agentId: 'agent-frontend', text: 'Dark mode colours come from CSS variables' }]);
    const pinned = loadLessons(root).find((l) => l.text.includes('number 7 '))!;
    updateLesson(root, pinned.id, { pinned: true });
    const ctx = await memoryContext(root, { agentId: 'agent-frontend', query: 'fix dark mode colours', budgetChars: 400 }, null);
    expect(ctx.lessons[0].id).toBe(pinned.id);
    expect(ctx.lessons.map((l) => l.text)).toContain('Dark mode colours come from CSS variables');
    expect(ctx.lessons.reduce((n, l) => n + l.text.length + 16, 0)).toBeLessThanOrEqual(400);
    expect(ctx.lessons.length).toBeLessThan(10);
  });
});

describe('Ollama embeddings', () => {
  it('recognises embedding models and prefers the chosen or recommended one', () => {
    expect(isEmbeddingModel({ name: 'nomic-embed-text:latest' })).toBe(true);
    expect(isEmbeddingModel({ name: 'bge-m3' })).toBe(true);
    expect(isEmbeddingModel({ name: 'custom', details: { family: 'nomic-bert' } })).toBe(true);
    expect(isEmbeddingModel({ name: 'qwen2.5:7b', details: { family: 'qwen2' } })).toBe(false);
    expect(chooseEmbeddingModel('auto', ['bge-m3', 'nomic-embed-text:latest'])).toBe('nomic-embed-text:latest');
    expect(chooseEmbeddingModel('auto', ['bge-m3'])).toBe('bge-m3');
    expect(chooseEmbeddingModel('bge-m3:latest', ['bge-m3'])).toBe('bge-m3');
    expect(chooseEmbeddingModel('mxbai-embed-large', ['bge-m3'])).toBeUndefined();
    expect(chooseEmbeddingModel('off', ['bge-m3'])).toBeUndefined();
    expect(chooseEmbeddingModel('auto', [])).toBeUndefined();
  });

  it('calls /api/embed with Nomic task prefixes, rejects bad replies, and streams pull progress', async () => {
    const seen: unknown[] = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const json = JSON.parse(body || '{}');
        seen.push({ url: req.url, ...json });
        if (req.url === '/api/embed') {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(json.model === 'bad' ? { embeddings: [[Number.NaN]] } : { embeddings: json.input.map((_: string, i: number) => [i, 1]) }));
        } else {
          res.write(JSON.stringify({ status: 'pulling manifest' }) + '\n');
          res.write(JSON.stringify({ status: 'downloading', completed: 50, total: 100 }) + '\n');
          res.end(JSON.stringify({ status: 'success' }) + '\n');
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      expect(await ollamaEmbedder('nomic-embed-text', endpoint).embed(['a', 'b'], 'document')).toEqual([[0, 1], [1, 1]]);
      await ollamaEmbedder('nomic-embed-text', endpoint).embed(['q'], 'query');
      await ollamaEmbedder('bge-m3', endpoint).embed(['plain'], 'query');
      expect(seen.map((s) => (s as { input: string[] }).input)).toEqual([['search_document: a', 'search_document: b'], ['search_query: q'], ['plain']]);
      await expect(ollamaEmbedder('bad', endpoint).embed(['x'], 'query')).rejects.toThrow(/did not return embeddings/);
      process.env.OLLAMA_HOST = endpoint;
      const events: unknown[] = [];
      await pullModel('nomic-embed-text', (e) => events.push(e), new AbortController().signal);
      expect(events).toEqual([{ status: 'pulling manifest' }, { status: 'downloading', completed: 50, total: 100 }, { status: 'success' }]);
    } finally {
      delete process.env.OLLAMA_HOST;
      server.close();
    }
  });
});
