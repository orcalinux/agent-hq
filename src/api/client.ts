import type {
  AIProviderId,
  EmbeddingStatus,
  Lesson,
  LessonInput,
  MemorySearchHit,
  MemorySearchMode,
  ChatUsage,
  CliDetection,
  ConnectionMethod,
  ModelInfo,
  ProviderConnectionInfo,
  ProviderState,
  WorkspaceTreeEntry,
} from '@/types';

export interface TerminalInfo {
  id: string;
  title: string;
  shell: string;
  cwd: string;
  pid: number;
  createdAt: number;
  exited: boolean;
  exitCode: number | null;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function call<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'Cannot reach the Agent HQ server. Is "npm run dev" running?');
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new ApiError(res.status, `Unexpected response from ${path} (HTTP ${res.status}).`);
  }
  if (!res.ok) {
    throw new ApiError(res.status, (data as { error?: string })?.error || `HTTP ${res.status}`);
  }
  return data as T;
}

// ------------------------------------------------------------------ connections

export const runJournalApi = {
  load: () => call<{ journal: { savedAt: string; mission: unknown } | null }>('GET', '/api/runs/journal'),
  save: (mission: unknown) => call<{ ok: true }>('PUT', '/api/runs/journal', { mission }),
  clear: () => call<{ ok: true }>('DELETE', '/api/runs/journal'),
};

export interface ConnectionsResponse {
  providers: ProviderState[];
}

export interface DetectResponse {
  clis: CliDetection[];
  ollama: { reachable: boolean; endpoint: string; models?: number; error?: string };
  magpie?: { reachable: boolean; endpoint: string; models?: number; error?: string };
  installs?: Record<string, { name: string; command: string | null; url: string }>;
}

export interface ConnectPayload {
  providerId: AIProviderId;
  method: ConnectionMethod;
  apiKey?: string;
  endpointUrl?: string;
}

export interface TestResult {
  ok: boolean;
  detail?: string;
  error?: string;
  models?: ModelInfo[];
  connection?: ProviderConnectionInfo;
}

export interface MagpieQuota {
  provider: string;
  name: string;
  kind: string;
  plan?: string;
  windows: Array<{ name: string; remaining: number; resetsAt?: string }>;
}

export type MagpieBalance = 'usage' | 'pace' | 'rotate' | 'weight';

export interface MagpieGroupSync {
  id: string;
  models: string[];
  routing: MagpieBalance;
  weights?: Record<string, number>;
}

export const api = {
  connections: () => call<ConnectionsResponse>('GET', '/api/connections'),
  detect: () => call<DetectResponse>('GET', '/api/connections/detect'),
  testConnection: (p: ConnectPayload) => call<TestResult>('POST', '/api/connections/test', p),
  connect: (p: ConnectPayload) => call<TestResult>('POST', '/api/connections/connect', p),
  disconnect: (providerId: AIProviderId) => call<{ ok: boolean }>('POST', '/api/connections/disconnect', { providerId }),
  refresh: (providerId: AIProviderId) => call<TestResult>('POST', '/api/connections/refresh', { providerId }),
  magpieQuotas: () => call<{ ok: boolean; quotas: MagpieQuota[]; error?: string }>('GET', '/api/magpie/quotas'),
  syncMagpieGroups: (groups: MagpieGroupSync[]) => call<{ ok: boolean; results: Array<{ id: string; ok: boolean; error?: string }> }>('POST', '/api/magpie/groups', { groups }),
  removeMagpieGroups: () => call<{ ok: boolean }>('POST', '/api/magpie/groups/remove'),
  rescanModels: () => call<{ ok: boolean; results: Array<{ providerId: AIProviderId; ok: boolean; count?: number; error?: string }> }>('POST', '/api/models/rescan'),

  terminalSessions: () => call<{ sessions: TerminalInfo[]; root: string }>('GET', '/api/terminal/sessions'),
  createTerminal: (cols: number, rows: number) => call<{ session: TerminalInfo }>('POST', '/api/terminal/sessions', { cols, rows }),
  terminalInput: (id: string, data: string) => call<{ ok: true }>('POST', '/api/terminal/input', { id, data }),
  terminalResize: (id: string, cols: number, rows: number) => call<{ ok: true }>('POST', '/api/terminal/resize', { id, cols, rows }),
  closeTerminal: (id: string) => call<{ ok: true }>('POST', '/api/terminal/close', { id }),
  terminalStreamUrl: (id: string) => `/api/terminal/stream?id=${encodeURIComponent(id)}`,

  /** Opens the user's own external terminal in the workspace; `install` runs that tool's official install command in it. */
  openTerminal: (install?: string) => call<{ terminal: string; cwd: string; command: string | null }>('POST', '/api/workspace/open-terminal', install ? { install } : {}),
  memory: (agentId?: string) =>
    call<{ file: string; lessons: Lesson[]; error?: string }>('GET', `/api/memory${agentId ? `?agentId=${encodeURIComponent(agentId)}` : ''}`),
  memoryStatus: () => call<{ embedding: EmbeddingStatus; mode: MemorySearchMode }>('GET', '/api/memory/status'),
  addLessons: (lessons: LessonInput[]) => call<{ added: Lesson[]; reinforced: Lesson[] }>('POST', '/api/memory/lessons', { lessons }),
  updateLesson: (id: string, patch: Partial<Pick<Lesson, 'text' | 'kind' | 'agentId' | 'pinned'>>) =>
    call<{ lesson: Lesson }>('PATCH', '/api/memory/lesson', { id, patch }),
  deleteLesson: (id: string) => call<{ ok: true }>('DELETE', '/api/memory/lesson', { id }),
  searchMemory: (query: string, agentId?: string, limit?: number) =>
    call<{ hits: MemorySearchHit[]; mode: MemorySearchMode; embeddingModel?: string; embeddingError?: string }>('POST', '/api/memory/search', { query, agentId, limit }),
  memoryContext: (agentId: string, query: string, budgetChars?: number) =>
    call<{ lessons: Lesson[]; total: number; mode: MemorySearchMode; embeddingError?: string }>('POST', '/api/memory/context', { agentId, query, budgetChars }),
  setEmbeddingModel: (model: string) => call<{ embedding: EmbeddingStatus; mode: MemorySearchMode }>('POST', '/api/memory/embedding', { model }),
  reindexMemory: () => call<{ indexed: number; model: string; durationMs: number }>('POST', '/api/memory/reindex'),
  workspace: () => call<{ root: string; name: string; lockedByEnv: boolean; recent: string[] }>('GET', '/api/workspace'),
  setWorkspaceRoot: (path: string) => call<{ root: string; name: string }>('POST', '/api/workspace/root', { path }),
  createProject: (p: { parent: string; name: string; gitInit: boolean; description?: string }) =>
    call<{ root: string; name: string; git: string }>('POST', '/api/workspace/create', p),
  browse: (path?: string, hidden = false) =>
    call<{ path: string; parent: string | null; home: string; isProject: boolean; dirs: Array<{ name: string; path: string; isProject: boolean }>; truncated: boolean }>(
      'GET',
      `/api/fs/browse?${path ? `path=${encodeURIComponent(path)}&` : ''}${hidden ? 'hidden=1' : ''}`
    ),
  files: () => call<{ root: string; files: WorkspaceTreeEntry[]; truncated: boolean }>('GET', '/api/workspace/files'),
  readFile: (path: string) =>
    call<{ path: string; content: string; size: number; binary: boolean }>('GET', `/api/workspace/file?path=${encodeURIComponent(path)}`),
  /** Like readFile, but a missing file is answered with `exists: false` instead of an error. */
  readFileIfExists: (path: string) =>
    call<{ path: string; exists: boolean; content: string; size: number; binary: boolean }>('GET', `/api/workspace/file?path=${encodeURIComponent(path)}&optional=1`),
  writeFile: (path: string, content: string, overwrite = true) =>
    call<{ path: string; size: number; created: boolean }>('PUT', '/api/workspace/file', { path, content, overwrite }),
  deleteFile: (path: string) => call<{ path: string }>('DELETE', '/api/workspace/file', { path }),
  upload: (files: Array<{ path: string; content: string }>, overwrite = false) =>
    call<{ ok: boolean; saved: string[]; errors: string[] }>('POST', '/api/workspace/upload', { files, overwrite }),
  git: () =>
    call<{
      isRepo: boolean;
      branch?: string;
      files: Array<{ path: string; status: string; additions?: number; deletions?: number }>;
    }>('GET', '/api/workspace/git'),
  allowedCommands: () =>
    call<{ commands: Array<{ program: string; subcommands?: string[]; description: string }> }>('GET', '/api/workspace/allowed-commands'),
  execute: (command: string, signal?: AbortSignal, timeoutMs?: number) =>
    call<ExecuteResult>('POST', '/api/workspace/execute', { command, timeoutMs }, signal),
};

export interface ExecuteResult {
  ok: boolean;
  rejected?: boolean;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
}

// ------------------------------------------------------------------ chat streaming

export interface ChatStreamRequest {
  model: string;
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  maxTokens?: number;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
}

export interface ChatStreamResult {
  text: string;
  usage?: ChatUsage;
  latencyMs: number;
  models?: ModelInfo[];
  /** The model a gateway actually routed the call to, such as one member of a Magpie group. */
  servedModel?: string;
}

export async function streamChat(req: ChatStreamRequest): Promise<ChatStreamResult> {
  let res: Response;
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: req.model, system: req.system, messages: req.messages, maxTokens: req.maxTokens }),
      signal: req.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'Cannot reach the Agent HQ server.');
  }
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, data.error || `HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let result: ChatStreamResult | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const line = frame.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      const ev = JSON.parse(line.slice(5).trim()) as {
        type: string;
        text?: string;
        message?: string;
        usage?: ChatUsage | null;
        latencyMs?: number;
        models?: ModelInfo[];
        servedModel?: string;
      };
      if (ev.type === 'delta' && ev.text) {
        text += ev.text;
        req.onDelta?.(ev.text);
      } else if (ev.type === 'error') {
        throw new ApiError(502, ev.message || 'Model call failed.');
      } else if (ev.type === 'done') {
        result = { text, usage: ev.usage ?? undefined, latencyMs: ev.latencyMs ?? 0, models: ev.models, ...(ev.servedModel ? { servedModel: ev.servedModel } : {}) };
      }
    }
  }
  if (!result) {
    if (req.signal?.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      throw err;
    }
    throw new ApiError(502, 'The model stream ended unexpectedly.');
  }
  return result;
}

/** Downloads an Ollama model, reporting progress as a 0..1 fraction when Ollama gives sizes. */
export async function pullEmbeddingModel(model: string, onProgress: (status: string, fraction?: number) => void, signal?: AbortSignal) {
  const res = await fetch('/api/memory/embedding/pull', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model }),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, data.error || `HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished: { embedding: EmbeddingStatus; mode: MemorySearchMode } | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const line = buffer.slice(0, idx).split('\n').find((l) => l.startsWith('data:'));
      buffer = buffer.slice(idx + 2);
      if (!line) continue;
      const ev = JSON.parse(line.slice(5).trim()) as { type: string; status?: string; completed?: number; total?: number; message?: string; embedding?: EmbeddingStatus; mode?: MemorySearchMode };
      if (ev.type === 'progress') onProgress(ev.status ?? '', ev.total ? (ev.completed ?? 0) / ev.total : undefined);
      else if (ev.type === 'error') throw new ApiError(502, ev.message || 'The download failed.');
      else if (ev.type === 'done' && ev.embedding && ev.mode) finished = { embedding: ev.embedding, mode: ev.mode };
    }
  }
  if (!finished) throw new ApiError(502, 'The download ended unexpectedly.');
  return finished;
}
