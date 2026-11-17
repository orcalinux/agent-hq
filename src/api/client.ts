import type {
  AIProviderId,
  ChatUsage,
  CliDetection,
  ConnectionMethod,
  ModelInfo,
  ProviderConnectionInfo,
  ProviderState,
  WorkspaceTreeEntry,
} from '@/types';

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

export interface ConnectionsResponse {
  providers: ProviderState[];
}

export interface DetectResponse {
  clis: CliDetection[];
  ollama: { reachable: boolean; endpoint: string; models?: number; error?: string };
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

export const api = {
  connections: () => call<ConnectionsResponse>('GET', '/api/connections'),
  detect: () => call<DetectResponse>('GET', '/api/connections/detect'),
  testConnection: (p: ConnectPayload) => call<TestResult>('POST', '/api/connections/test', p),
  connect: (p: ConnectPayload) => call<TestResult>('POST', '/api/connections/connect', p),
  disconnect: (providerId: AIProviderId) => call<{ ok: boolean }>('POST', '/api/connections/disconnect', { providerId }),
  refresh: (providerId: AIProviderId) => call<TestResult>('POST', '/api/connections/refresh', { providerId }),

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
  writeFile: (path: string, content: string, overwrite = true) =>
    call<{ path: string; size: number; created: boolean }>('PUT', '/api/workspace/file', { path, content, overwrite }),
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
      };
      if (ev.type === 'delta' && ev.text) {
        text += ev.text;
        req.onDelta?.(ev.text);
      } else if (ev.type === 'error') {
        throw new ApiError(502, ev.message || 'Model call failed.');
      } else if (ev.type === 'done') {
        result = { text, usage: ev.usage ?? undefined, latencyMs: ev.latencyMs ?? 0 };
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
