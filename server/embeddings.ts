import { loadConfig } from './config';
import type { Embedder } from './memory';

export const RECOMMENDED_EMBEDDING_MODEL = 'nomic-embed-text';
const EMBEDDING_NAME = /embed|(^|[^a-z])(bge|gte|e5|minilm|mxbai|arctic|paraphrase|granite-embedding)/i;
const EMBEDDING_FAMILY = /bert/i;

export interface OllamaModelTag {
  name: string;
  details?: { family?: string; families?: string[] | null };
}

export interface EmbeddingStatus {
  endpoint: string;
  reachable: boolean;
  preference: string;
  /** Installed models that produce embeddings. */
  installed: string[];
  /** The model search uses now, or undefined when search is keyword only. */
  active?: string;
  recommended: string;
  error?: string;
}

export function ollamaBase(): string {
  const conn = loadConfig().connections.ollama;
  if (conn?.endpointUrl) return conn.endpointUrl.replace(/\/+$/, '');
  const host = process.env.OLLAMA_HOST;
  return host ? `http://${host.replace(/^https?:\/\//, '').replace(/\/+$/, '')}` : 'http://127.0.0.1:11434';
}

export function isEmbeddingModel(tag: OllamaModelTag): boolean {
  const families = [tag.details?.family, ...(tag.details?.families ?? [])].filter(Boolean).join(' ');
  return EMBEDDING_NAME.test(tag.name) || EMBEDDING_FAMILY.test(families);
}

const sameModel = (a: string, b: string) => a.replace(/:latest$/, '') === b.replace(/:latest$/, '');

/** Picks the user's chosen model when installed, otherwise the first installed embedding model. */
export function chooseEmbeddingModel(preference: string, installed: string[]): string | undefined {
  if (preference === 'off') return;
  if (preference && preference !== 'auto') return installed.find((m) => sameModel(m, preference));
  return installed.find((m) => sameModel(m, RECOMMENDED_EMBEDDING_MODEL)) ?? installed[0];
}

async function fetchJson(url: string, init: RequestInit & { timeoutMs: number }): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs) });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error || `Ollama answered HTTP ${res.status}.`);
  return body;
}

export async function embeddingStatus(): Promise<EmbeddingStatus> {
  const endpoint = ollamaBase();
  const preference = loadConfig().memory?.embeddingModel || 'auto';
  const base = { endpoint, preference, recommended: RECOMMENDED_EMBEDDING_MODEL };
  try {
    const tags = (await fetchJson(`${endpoint}/api/tags`, { timeoutMs: 2500 })) as { models?: OllamaModelTag[] };
    const installed = (tags.models ?? []).filter(isEmbeddingModel).map((m) => m.name);
    return { ...base, reachable: true, installed, active: chooseEmbeddingModel(preference, installed) };
  } catch (err) {
    return { ...base, reachable: false, installed: [], error: (err as Error).name === 'TimeoutError' ? 'Ollama did not answer.' : (err as Error).message };
  }
}

export function ollamaEmbedder(model: string, endpoint = ollamaBase()): Embedder {
  const nomic = /nomic-embed/i.test(model);
  return {
    model,
    async embed(texts, purpose) {
      const input = nomic ? texts.map((t) => `${purpose === 'query' ? 'search_query' : 'search_document'}: ${t}`) : texts;
      const body = (await fetchJson(`${endpoint}/api/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, input, truncate: true }),
        timeoutMs: 60_000,
      })) as { embeddings?: unknown };
      const vectors = body.embeddings;
      if (!Array.isArray(vectors) || vectors.length !== texts.length || !vectors.every((v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'number' && Number.isFinite(x)))) {
        throw new Error(`${model} did not return embeddings.`);
      }
      return vectors as number[][];
    },
  };
}

let cached: { at: number; embedder: Embedder | null; status: EmbeddingStatus } | null = null;

export function forgetEmbedder() {
  cached = null;
}

/** The embedder memory search should use now, rechecked every 30 seconds. */
export async function currentEmbedder(): Promise<{ embedder: Embedder | null; status: EmbeddingStatus }> {
  if (cached && Date.now() - cached.at < 30_000) return cached;
  const status = await embeddingStatus();
  cached = { at: Date.now(), status, embedder: status.active ? ollamaEmbedder(status.active, status.endpoint) : null };
  return cached;
}

/** Streams Ollama's pull progress for a model as { status, completed, total } events. */
export async function pullModel(model: string, onEvent: (event: { status: string; completed?: number; total?: number }) => void, signal: AbortSignal) {
  const res = await fetch(`${ollamaBase()}/api/pull`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, stream: true }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Ollama could not start the download (HTTP ${res.status}).`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as { status?: string; completed?: number; total?: number; error?: string };
      if (event.error) throw new Error(event.error);
      onEvent({ status: event.status ?? '', completed: event.completed, total: event.total });
    }
  }
  forgetEmbedder();
}
