import { spawn, execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ConnectionMethod, ProviderId, StoredConnection } from './config';
import { claudeCliUsage, claudeModelChoices, observeCliModels, reportedClaudeModels, type ClaudeCliUsage } from './cliModelIdentity';
import type { ClaudePricing } from './claudeCatalog';

export interface ModelInfo {
  ref: string;
  providerId: ProviderId;
  id: string;
  name: string;
  via: ConnectionMethod;
  selectable?: boolean;
  canonicalRef?: string;
  contextWindow?: number;
  capabilities: string[];
  pricing?: { inputPerM: number; outputPerM: number; source: 'provider' | 'local' } | ClaudePricing;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cacheWrite1hTokens?: number;
}

export interface ChatResult {
  text: string;
  usage?: ChatUsage;
  latencyMs: number;
  resolvedModels?: string[];
  /** The model that actually answered, when a gateway routed the request (Magpie groups). */
  servedModel?: string;
}

export interface ChatRequest {
  connection: StoredConnection;
  model: string;
  system?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  cwd: string;
  signal: AbortSignal;
  onDelta: (text: string) => void;
}

export interface ProviderDescriptor {
  id: ProviderId;
  name: string;
  methods: ConnectionMethod[];
  envVars: string[];
  cliBinary?: string;
  defaultEndpoint?: string;
  docsUrl: string;
  notes: string;
}

export const PROVIDERS: ProviderDescriptor[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    methods: ['api_key', 'env_key', 'cli'],
    envVars: ['ANTHROPIC_API_KEY'],
    cliBinary: 'claude',
    docsUrl: 'https://docs.anthropic.com/en/api/getting-started',
    notes:
      'API keys come from the Anthropic Console. The Claude Code CLI ("claude") can be used with whatever account it is already signed in to, including a Claude subscription, by running it in non-interactive print mode.',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    methods: ['api_key', 'env_key', 'cli'],
    envVars: ['OPENAI_API_KEY'],
    cliBinary: 'codex',
    docsUrl: 'https://platform.openai.com/docs/quickstart',
    notes:
      'API keys come from the OpenAI Platform; a ChatGPT subscription does not include API access. The Codex CLI ("codex") can run with its own sign-in (including ChatGPT plans) via "codex exec" in a read-only sandbox.',
  },
  {
    id: 'google',
    name: 'Google Gemini',
    methods: ['api_key', 'env_key', 'cli'],
    envVars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    cliBinary: 'gemini',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/api-key',
    notes:
      'API keys come from Google AI Studio. The Gemini CLI ("gemini") can be used with its own sign-in in non-interactive prompt mode.',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    methods: ['api_key', 'env_key'],
    envVars: ['OPENROUTER_API_KEY'],
    docsUrl: 'https://openrouter.ai/docs/quickstart',
    notes: 'One API key for many hosted models. Model pricing and context windows are reported by OpenRouter.',
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    methods: ['local_endpoint'],
    envVars: ['OLLAMA_HOST'],
    cliBinary: 'ollama',
    defaultEndpoint: 'http://127.0.0.1:11434',
    docsUrl: 'https://github.com/ollama/ollama',
    notes: 'Runs models on this machine. No account or API cost. Install models with "ollama pull <model>".',
  },
  {
    id: 'magpie',
    name: 'Magpie gateway',
    methods: ['local_endpoint'],
    envVars: ['MAGPIE_GATEWAY'],
    defaultEndpoint: 'http://127.0.0.1:3425',
    docsUrl: 'https://usemagpie.ai',
    notes:
      'Uses the models, routing groups, subscriptions and failover you set up in Magpie, through its local gateway. Agent HQ stores no keys for it; set MAGPIE_API_KEY only if your gateway requires a caller key.',
  },
];

export function providerDescriptor(id: ProviderId): ProviderDescriptor | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export function envKeyFor(id: ProviderId): string | undefined {
  if (id === 'magpie') return undefined;
  const desc = providerDescriptor(id);
  for (const name of desc?.envVars ?? []) {
    const value = process.env[name];
    if (value && name !== 'OLLAMA_HOST') return value;
  }
  return undefined;
}

/** The Magpie gateway address: MAGPIE_GATEWAY, then the address Magpie itself recorded, then its default. */
export function magpieEndpoint(): string {
  const fromEnv = process.env.MAGPIE_GATEWAY?.trim();
  if (fromEnv) return /^https?:\/\//.test(fromEnv) ? fromEnv : `http://${fromEnv}`;
  try {
    const file = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'magpie', 'gateway.json');
    const addr = (JSON.parse(fs.readFileSync(file, 'utf8')) as { addr?: unknown }).addr;
    if (typeof addr === 'string' && /^[\w.\-[\]:]+:\d+$/.test(addr)) return `http://${addr}`;
  } catch {
    // Magpie is not installed or has not started its gateway yet
  }
  return 'http://127.0.0.1:3425';
}

function magpieHeaders(): Record<string, string> {
  const key = process.env.MAGPIE_API_KEY?.trim();
  return key ? { authorization: `Bearer ${key}` } : {};
}

export interface MagpieModelEntry {
  id?: unknown;
  magpie_label?: unknown;
  display_name?: unknown;
  context_length?: unknown;
  context_window?: unknown;
  modalities?: { input?: unknown };
  supported_parameters?: unknown;
}

/** Turns Magpie's /v1/models answer into Agent HQ models. Routing groups come first. */
export function parseMagpieModels(data: { data?: MagpieModelEntry[] }, via: ConnectionMethod = 'local_endpoint'): ModelInfo[] {
  const models: ModelInfo[] = [];
  for (const m of data.data ?? []) {
    if (typeof m.id !== 'string' || !m.id) continue;
    const label = typeof m.magpie_label === 'string' ? m.magpie_label : typeof m.display_name === 'string' ? m.display_name : m.id;
    const ctx = Number(m.context_length ?? m.context_window);
    const capabilities = ['chat'];
    if (Array.isArray(m.modalities?.input) && m.modalities.input.includes('image')) capabilities.push('vision');
    if (Array.isArray(m.supported_parameters) && m.supported_parameters.includes('tools')) capabilities.push('tools');
    models.push({
      ref: `magpie:${m.id}`,
      providerId: 'magpie',
      id: m.id,
      name: label,
      via,
      ...(Number.isFinite(ctx) && ctx > 0 ? { contextWindow: ctx } : {}),
      capabilities,
    });
  }
  return models.sort((a, b) => Number(!a.id.startsWith('group/')) - Number(!b.id.startsWith('group/')));
}

export function apiKeyFor(conn: StoredConnection): string | undefined {
  if (conn.method === 'env_key') return envKeyFor(conn.providerId);
  return conn.apiKey;
}

// ------------------------------------------------------------------ CLI detection

export interface CliInfo {
  binary: string;
  detected: boolean;
  path?: string;
  version?: string;
  auth?: { checked: boolean; ok?: boolean; detail?: string };
  executionSupported: boolean;
  purpose: string;
}

function run(
  file: string,
  args: string[],
  opts: { timeoutMs?: number; cwd?: string; input?: string } = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = execFile(
      file,
      args,
      { timeout: opts.timeoutMs ?? 4000, cwd: opts.cwd, maxBuffer: 4 * 1024 * 1024, env: envFor(file) },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
        resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') || (error && !stdout ? error.message : '') });
      }
    );
    if (opts.input !== undefined) {
      child.stdin?.end(opts.input);
    }
  });
}

function envFor(binary: string): NodeJS.ProcessEnv {
  if (!path.isAbsolute(binary)) return process.env;
  const dir = path.dirname(binary);
  const current = process.env.PATH || '';
  return current.split(path.delimiter).includes(dir) ? process.env : { ...process.env, PATH: dir + path.delimiter + current };
}

function nodeVersionBins(root: string): string[] {
  try {
    return fs
      .readdirSync(root)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .map((v) => path.join(root, v, 'bin'));
  } catch {
    return [];
  }
}

/** Common install locations that are often missing from the PATH of a process started outside a login shell. */
function extraBinDirs(): string[] {
  const home = os.homedir();
  return [
    path.join(home, '.local', 'bin'),
    path.join(home, '.claude', 'local'),
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.volta', 'bin'),
    path.join(home, '.yarn', 'bin'),
    ...nodeVersionBins(path.join(home, '.nvm', 'versions', 'node')),
    ...nodeVersionBins(path.join(home, '.config', 'nvm', 'versions', 'node')),
    ...(process.env.NVM_DIR ? nodeVersionBins(path.join(process.env.NVM_DIR, 'versions', 'node')) : []),
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/usr/lib/chatgpt/resources',
    '/Applications/ChatGPT.app/Contents/Resources',
  ];
}

export function findOnPath(binary: string): string | undefined {
  if (!binary) return undefined;
  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (const dir of [...dirs, ...extraBinDirs()]) {
    if (!dir) continue;
    const candidate = path.join(dir, binary);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // not here
    }
  }
  return undefined;
}

const CLI_PURPOSE: Record<string, { purpose: string; executionSupported: boolean }> = {
  claude: { purpose: 'Claude Code CLI — model execution with its own sign-in', executionSupported: true },
  codex: { purpose: 'OpenAI Codex CLI — model execution with its own sign-in', executionSupported: true },
  gemini: { purpose: 'Gemini CLI — model execution with its own sign-in', executionSupported: true },
  ollama: { purpose: 'Ollama — local model runtime (used through its HTTP endpoint)', executionSupported: true },
  gh: { purpose: 'GitHub CLI — repository tooling (not a model provider)', executionSupported: false },
  agy: { purpose: 'Detected, but Agent HQ has no supported non-interactive integration for it', executionSupported: false },
};

export async function detectCli(binary: string): Promise<CliInfo> {
  const meta = CLI_PURPOSE[binary] ?? { purpose: 'Developer CLI', executionSupported: false };
  const binPath = findOnPath(binary);
  if (!binPath) return { binary, detected: false, executionSupported: meta.executionSupported, purpose: meta.purpose };
  const ver = await run(binPath, ['--version'], { timeoutMs: 4000 });
  const version = (ver.stdout || ver.stderr).split('\n').find((l) => l.trim())?.trim().slice(0, 80);
  const info: CliInfo = {
    binary,
    detected: true,
    path: binPath,
    version,
    executionSupported: meta.executionSupported,
    purpose: meta.purpose,
  };
  if (binary === 'gh') {
    const auth = await run(binPath, ['auth', 'status'], { timeoutMs: 6000 });
    const text = (auth.stdout + auth.stderr).trim();
    const account = text.match(/account\s+(\S+)/i)?.[1] || text.match(/as\s+(\S+)/i)?.[1];
    info.auth = { checked: true, ok: auth.code === 0, detail: auth.code === 0 ? `Signed in${account ? ` as ${account}` : ''}` : 'Not signed in (run "gh auth login")' };
  } else if (binary === 'codex') {
    const auth = await run(binPath, ['login', 'status'], { timeoutMs: 6000 });
    const text = (auth.stdout + auth.stderr).trim().split('\n')[0];
    info.auth = { checked: true, ok: auth.code === 0, detail: auth.code === 0 ? text || 'Signed in' : 'Not signed in (run "codex login")' };
  } else if (binary === 'claude' || binary === 'gemini') {
    info.auth = { checked: false, detail: 'Sign-in is confirmed by running a test prompt.' };
  }
  return info;
}

export const DETECTED_CLIS = ['claude', 'codex', 'gemini', 'ollama', 'gh', 'agy'];

// ------------------------------------------------------------------ HTTP helpers

async function httpJson(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 10_000);
  try {
    const res = await fetch(url, { ...init, signal: init.signal ?? controller.signal });
    const text = await res.text();
    let body: unknown = undefined;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = text;
    }
    if (!res.ok) throw new Error(describeHttpError(res.status, body));
    return body;
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new Error(`Request to ${new URL(url).host} timed out.`);
    if ((err as Error).message?.startsWith('fetch failed')) throw new Error(`Could not reach ${new URL(url).host}.`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function describeHttpError(status: number, body: unknown): string {
  const msg =
    (body as { error?: { message?: string } })?.error?.message ||
    (body as { error?: string })?.error ||
    (body as { message?: string })?.message ||
    (typeof body === 'string' ? body.slice(0, 200) : '');
  const prefix =
    status === 401 || status === 403
      ? 'Authentication failed'
      : status === 404
        ? 'Not found'
        : status === 429
          ? 'Rate limited or out of quota'
          : `HTTP ${status}`;
  return msg ? `${prefix}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}` : prefix;
}

async function* readLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      yield buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
    }
  }
  if (buffer.trim()) yield buffer;
}

async function* readSseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  for await (const line of readLines(body)) {
    if (line.startsWith('data:')) yield line.slice(5).trim();
  }
}

async function streamingPost(url: string, headers: Record<string, string>, payload: unknown, signal: AbortSignal, onResponse?: (res: Response) => void) {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(payload), signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new Error(`Could not reach ${new URL(url).host}.`);
  }
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // keep text
    }
    throw new Error(describeHttpError(res.status, body));
  }
  onResponse?.(res);
  return res.body;
}

// ------------------------------------------------------------------ Model discovery

const OPENAI_NON_CHAT = /(embedding|whisper|tts|dall-e|moderation|davinci|babbage|image|audio|realtime|transcribe|search|computer-use|sora)/i;

export async function discoverModels(conn: StoredConnection, cwd = ''): Promise<ModelInfo[]> {
  const { providerId, method } = conn;
  if (method === 'cli') return cliModels(conn, cwd);
  const key = apiKeyFor(conn);
  switch (providerId) {
    case 'anthropic': {
      if (!key) throw new Error('No API key available.');
      const data = (await httpJson('https://api.anthropic.com/v1/models?limit=100', {
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      })) as { data?: Array<{ id: string; display_name?: string }> };
      return (data.data ?? []).map((m) => ({
        ref: `anthropic:${m.id}`,
        providerId,
        id: m.id,
        name: m.display_name || m.id,
        via: method,
        capabilities: ['chat'],
      }));
    }
    case 'openai': {
      if (!key) throw new Error('No API key available.');
      const data = (await httpJson('https://api.openai.com/v1/models', {
        headers: { authorization: `Bearer ${key}` },
      })) as { data?: Array<{ id: string }> };
      return (data.data ?? [])
        .filter((m) => !OPENAI_NON_CHAT.test(m.id))
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((m) => ({ ref: `openai:${m.id}`, providerId, id: m.id, name: m.id, via: method, capabilities: ['chat'] }));
    }
    case 'google': {
      if (!key) throw new Error('No API key available.');
      const data = (await httpJson('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', {
        headers: { 'x-goog-api-key': key },
      })) as {
        models?: Array<{ name: string; displayName?: string; inputTokenLimit?: number; supportedGenerationMethods?: string[] }>;
      };
      return (data.models ?? [])
        .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m) => {
          const id = m.name.replace(/^models\//, '');
          return {
            ref: `google:${id}`,
            providerId,
            id,
            name: m.displayName || id,
            via: method,
            contextWindow: m.inputTokenLimit,
            capabilities: ['chat'],
          };
        });
    }
    case 'openrouter': {
      if (!key) throw new Error('No API key available.');
      await httpJson('https://openrouter.ai/api/v1/key', { headers: { authorization: `Bearer ${key}` } });
      const data = (await httpJson('https://openrouter.ai/api/v1/models', {
        headers: { authorization: `Bearer ${key}` },
        timeoutMs: 20_000,
      })) as {
        data?: Array<{ id: string; name?: string; context_length?: number; pricing?: { prompt?: string; completion?: string } }>;
      };
      return (data.data ?? []).map((m) => {
        const inP = Number(m.pricing?.prompt);
        const outP = Number(m.pricing?.completion);
        return {
          ref: `openrouter:${m.id}`,
          providerId,
          id: m.id,
          name: m.name || m.id,
          via: method,
          contextWindow: m.context_length,
          capabilities: ['chat'],
          pricing:
            Number.isFinite(inP) && Number.isFinite(outP) && inP >= 0 && outP >= 0
              ? { inputPerM: inP * 1_000_000, outputPerM: outP * 1_000_000, source: 'provider' as const }
              : undefined,
        };
      });
    }
    case 'ollama': {
      const base = (conn.endpointUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');
      const data = (await httpJson(`${base}/api/tags`, { timeoutMs: 5000 })) as {
        models?: Array<{ name: string; details?: { parameter_size?: string } }>;
      };
      const models = data.models ?? [];
      return Promise.all(
        models.map(async (m) => {
          let contextWindow: number | undefined;
          let capabilities: string[] = ['chat'];
          try {
            const show = (await httpJson(`${base}/api/show`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ model: m.name }),
              timeoutMs: 5000,
            })) as { model_info?: Record<string, unknown>; capabilities?: string[] };
            const ctxKey = Object.keys(show.model_info ?? {}).find((k) => k.endsWith('.context_length'));
            if (ctxKey) contextWindow = Number(show.model_info?.[ctxKey]) || undefined;
            if (Array.isArray(show.capabilities) && show.capabilities.length) {
              capabilities = show.capabilities.map((c) => (c === 'completion' ? 'chat' : c));
            }
          } catch {
            // details are optional
          }
          return {
            ref: `ollama:${m.name}`,
            providerId,
            id: m.name,
            name: m.details?.parameter_size ? `${m.name} (${m.details.parameter_size})` : m.name,
            via: method,
            contextWindow,
            capabilities,
            pricing: { inputPerM: 0, outputPerM: 0, source: 'local' as const },
          };
        })
      );
    }
    case 'magpie': {
      const base = (conn.endpointUrl || magpieEndpoint()).replace(/\/+$/, '');
      const data = (await httpJson(`${base}/v1/models`, { headers: magpieHeaders(), timeoutMs: 5000 })) as { data?: MagpieModelEntry[] };
      return parseMagpieModels(data, method);
    }
    default:
      return [];
  }
}

/** Models the signed-in Codex account can use, from the Codex CLI's own model cache. */
function codexCachedModels(): Array<[string, string, number | undefined]> {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(home, 'models_cache.json'), 'utf8')) as {
      models?: Array<{ slug?: string; display_name?: string; visibility?: string; context_window?: number }>;
    };
    return (raw.models ?? [])
      .filter((m) => m.slug && !m.slug.includes('/') && (m.visibility ?? 'list') === 'list')
      .map((m) => [m.slug!, (m.display_name || m.slug!) + ' · Codex CLI', m.context_window]);
  } catch {
    return [];
  }
}

function cliModels(conn: StoredConnection, cwd: string): ModelInfo[] {
  if (conn.providerId === 'anthropic') {
    return claudeModelChoices(conn, cwd).map((model) => ({
      ...model, ref: `anthropic:cli:${model.id}`, id: `cli:${model.id}`,
      providerId: 'anthropic', via: 'cli',
    }));
  }
  const codex = conn.providerId === 'openai' ? codexCachedModels() : [];
  const aliases: Partial<Record<ProviderId, Array<[string, string]>>> = {
    openai: [['default', 'Codex CLI (configured default model)'], ...codex.map(([id, name]) => [id, name] as [string, string])],
    google: [['default', 'Gemini CLI (configured default model)']],
  };
  const contextOf = new Map(codex.map(([id, , ctx]) => [id, ctx]));
  return (aliases[conn.providerId] ?? []).map(([id, name]) => ({
    ...(contextOf.get(id) ? { contextWindow: contextOf.get(id) } : {}),
    ref: `${conn.providerId}:cli:${id}`,
    providerId: conn.providerId,
    id: `cli:${id}`,
    name,
    via: 'cli' as const,
    capabilities: ['chat'],
  }));
}

// ------------------------------------------------------------------ Chat

function flattenForCli(system: string | undefined, messages: ChatMessage[]): string {
  const parts: string[] = [];
  if (system) parts.push(`<instructions>\n${system}\n</instructions>`);
  if (messages.length === 1) {
    parts.push(messages[0].content);
  } else {
    parts.push(
      messages
        .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n\n')
    );
    parts.push('Respond to the last User message.');
  }
  return parts.join('\n\n');
}

function runCliStreaming(
  binary: string,
  args: string[],
  input: string | undefined,
  cwd: string,
  signal: AbortSignal,
  timeoutMs = 10 * 60_000
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd, env: envFor(binary), stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    const onAbort = () => child.kill('SIGTERM');
    signal.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      if (signal.aborted) {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        reject(err);
        return;
      }
      resolve({ code: code ?? 1, stdout, stderr });
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

async function chatViaCli(req: ChatRequest): Promise<ChatResult> {
  const start = Date.now();
  const { connection, model } = req;
  const binary = findOnPath(connection.cliBinary || providerDescriptor(connection.providerId)?.cliBinary || '');
  if (!binary) throw new Error(`The ${connection.cliBinary || 'provider'} CLI is not installed or not on PATH.`);
  const alias = model.replace(/^cli:/, '');
  const prompt = flattenForCli(req.system, req.messages);

  if (connection.providerId === 'anthropic') {
    const args = ['-p', '--output-format', 'json'];
    if (alias && alias !== 'default') args.push('--model', alias);
    const out = await runCliStreaming(binary, args, prompt, req.cwd, req.signal);
    let parsed: { result?: string; is_error?: boolean; modelUsage?: unknown; usage?: ClaudeCliUsage } | undefined;
    try {
      parsed = JSON.parse(out.stdout.trim().split('\n').filter(Boolean).pop() || '');
    } catch {
      parsed = undefined;
    }
    if (out.code !== 0 || !parsed || parsed.is_error) {
      throw new Error(parsed?.result || out.stderr.trim().slice(0, 400) || `claude exited with code ${out.code}`);
    }
    const text = parsed.result ?? '';
    req.onDelta(text);
    return {
      text,
      resolvedModels: reportedClaudeModels(parsed),
      usage: parsed.usage ? claudeCliUsage(parsed.usage) : undefined,
      latencyMs: Date.now() - start,
    };
  }

  if (connection.providerId === 'openai') {
    const lastFile = path.join(os.tmpdir(), `agent-hq-codex-${process.pid}-${Date.now()}.txt`);
    const args = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--output-last-message', lastFile];
    if (alias && alias !== 'default') args.push('-m', alias);
    args.push('-');
    const out = await runCliStreaming(binary, args, prompt, req.cwd, req.signal);
    let text = '';
    try {
      text = fs.readFileSync(lastFile, 'utf8');
      fs.unlinkSync(lastFile);
    } catch {
      text = out.stdout;
    }
    if (out.code !== 0) throw new Error(out.stderr.trim().split('\n').slice(-3).join(' ').slice(0, 400) || `codex exited with code ${out.code}`);
    const used = (out.stderr + out.stdout).match(/tokens used:?\s*([\d,]+)/i)?.[1];
    req.onDelta(text);
    return {
      text,
      usage: used ? { totalTokens: Number(used.replace(/,/g, '')) } : undefined,
      latencyMs: Date.now() - start,
    };
  }

  if (connection.providerId === 'google') {
    if (prompt.length > 100_000) throw new Error('Prompt is too large for the Gemini CLI argument limit.');
    const out = await runCliStreaming(binary, ['-p', prompt], undefined, req.cwd, req.signal);
    if (out.code !== 0) throw new Error(out.stderr.trim().slice(0, 400) || `gemini exited with code ${out.code}`);
    req.onDelta(out.stdout);
    return { text: out.stdout, latencyMs: Date.now() - start };
  }

  throw new Error('This provider has no CLI execution support.');
}

export async function chat(req: ChatRequest): Promise<ChatResult> {
  const { connection, model, system, messages, signal, onDelta } = req;
  if (connection.method === 'cli') return chatViaCli(req);
  const start = Date.now();
  const key = apiKeyFor(connection);
  let text = '';
  const usage: ChatUsage = {};
  let servedModel: string | undefined;
  const emit = (t: string) => {
    if (!t) return;
    text += t;
    onDelta(t);
  };

  switch (connection.providerId) {
    case 'anthropic': {
      if (!key) throw new Error('No Anthropic API key available.');
      const body = await streamingPost(
        'https://api.anthropic.com/v1/messages',
        { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        { model, system, messages, max_tokens: req.maxTokens ?? 8192, stream: true },
        signal
      );
      for await (const data of readSseData(body)) {
        let ev: Record<string, any>;
        try {
          ev = JSON.parse(data);
        } catch {
          continue;
        }
        if (ev.type === 'message_start') usage.inputTokens = ev.message?.usage?.input_tokens;
        else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') emit(ev.delta.text);
        else if (ev.type === 'message_delta' && ev.usage) usage.outputTokens = ev.usage.output_tokens;
        else if (ev.type === 'error') throw new Error(ev.error?.message || 'Anthropic stream error');
      }
      break;
    }
    case 'openai':
    case 'openrouter':
    case 'magpie': {
      const isMagpie = connection.providerId === 'magpie';
      if (!key && !isMagpie) throw new Error('No API key available.');
      const url = isMagpie
        ? `${(connection.endpointUrl || magpieEndpoint()).replace(/\/+$/, '')}/v1/chat/completions`
        : connection.providerId === 'openai'
          ? 'https://api.openai.com/v1/chat/completions'
          : 'https://openrouter.ai/api/v1/chat/completions';
      const headers: Record<string, string> = isMagpie
        ? magpieHeaders()
        : { authorization: `Bearer ${key}`, ...(connection.providerId === 'openrouter' ? { 'X-Title': 'Agent HQ' } : {}) };
      const body = await streamingPost(
        url,
        headers,
        {
          model,
          stream: true,
          stream_options: { include_usage: true },
          messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages],
        },
        signal,
        (res) => {
          const served = res.headers.get('x-magpie-model');
          if (isMagpie && served && served !== model) servedModel = `magpie:${served}`;
        }
      );
      for await (const data of readSseData(body)) {
        if (data === '[DONE]') break;
        let ev: Record<string, any>;
        try {
          ev = JSON.parse(data);
        } catch {
          continue;
        }
        if (ev.error) throw new Error(ev.error.message || 'Stream error');
        emit(ev.choices?.[0]?.delta?.content ?? '');
        if (ev.usage) {
          usage.inputTokens = ev.usage.prompt_tokens;
          usage.outputTokens = ev.usage.completion_tokens;
        }
      }
      break;
    }
    case 'google': {
      if (!key) throw new Error('No Gemini API key available.');
      const body = await streamingPost(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
        { 'x-goog-api-key': key },
        {
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        },
        signal
      );
      for await (const data of readSseData(body)) {
        let ev: Record<string, any>;
        try {
          ev = JSON.parse(data);
        } catch {
          continue;
        }
        const parts = ev.candidates?.[0]?.content?.parts ?? [];
        for (const p of parts) if (typeof p.text === 'string' && !p.thought) emit(p.text);
        if (ev.usageMetadata) {
          usage.inputTokens = ev.usageMetadata.promptTokenCount;
          usage.outputTokens = ev.usageMetadata.candidatesTokenCount;
        }
      }
      break;
    }
    case 'ollama': {
      const base = (connection.endpointUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');
      const body = await streamingPost(
        `${base}/api/chat`,
        {},
        { model, stream: true, messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages] },
        signal
      );
      for await (const line of readLines(body)) {
        if (!line.trim()) continue;
        let ev: Record<string, any>;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (ev.error) throw new Error(ev.error);
        emit(ev.message?.content ?? '');
        if (ev.done) {
          usage.inputTokens = ev.prompt_eval_count;
          usage.outputTokens = ev.eval_count;
        }
      }
      break;
    }
    default:
      throw new Error('Unsupported provider.');
  }
  const hasUsage = usage.inputTokens !== undefined || usage.outputTokens !== undefined;
  return { text, usage: hasUsage ? usage : undefined, latencyMs: Date.now() - start, ...(servedModel ? { servedModel } : {}) };
}

export async function verifyConnection(conn: StoredConnection, cwd: string): Promise<{ models: ModelInfo[]; detail: string }> {
  if (conn.method === 'cli') {
    const desc = providerDescriptor(conn.providerId);
    const binary = conn.cliBinary || desc?.cliBinary;
    if (!binary) throw new Error('This provider has no supported CLI.');
    const info = await detectCli(binary);
    if (!info.detected) throw new Error(`"${binary}" was not found on PATH.`);
    if (info.auth?.checked && !info.auth.ok) throw new Error(info.auth.detail || `${binary} is not signed in.`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      const result = await chat({
        connection: conn,
        model: 'cli:default',
        messages: [{ role: 'user', content: 'Reply with exactly the word OK and nothing else.' }],
        cwd,
        signal: controller.signal,
        onDelta: () => {},
      });
      if (!result.text.trim()) throw new Error(`${binary} returned an empty response.`);
      observeCliModels(conn, cwd, 'cli:default', result.resolvedModels ?? []);
      return { models: cliModels(conn, cwd), detail: `${info.version ?? binary} answered a test prompt in ${result.latencyMs} ms` };
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw new Error(`${binary} did not answer within 120 s.`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  const models = await discoverModels(conn);
  if (conn.providerId === 'ollama' && models.length === 0) {
    return { models, detail: 'Ollama is running but has no models installed. Run "ollama pull <model>".' };
  }
  if (conn.providerId === 'magpie' && models.length === 0) {
    return { models, detail: 'Magpie is running but offers no models yet. Add a provider or a routing group in Magpie.' };
  }
  return { models, detail: `Verified · ${models.length} model${models.length === 1 ? '' : 's'} available` };
}
