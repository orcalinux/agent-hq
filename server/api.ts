import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile, spawn } from 'child_process';
import type { IncomingMessage, ServerResponse } from 'http';
import {
  ConnectionMethod,
  getWorkspaceRoot,
  loadConfig,
  maskSecret,
  ProviderId,
  StoredConnection,
  updateConfig,
} from './config';
import { ALLOWED_COMMANDS, isLoopbackRequest, parseAllowedCommand, resolveInside } from './security';
import { TerminalError, closeTerminal, createTerminal, listTerminals, resizeTerminal, streamTerminal, writeTerminal } from './pty';
import {
  chat,
  ChatMessage,
  DETECTED_CLIS,
  detectCli,
  discoverModels,
  envKeyFor,
  findOnPath,
  magpieEndpoint,
  ModelInfo,
  PROVIDERS,
  providerDescriptor,
  verifyConnection,
} from './providers';
import { INSTALL_GUIDES, installCommandFor } from './installers';
import { buildTerminalLaunch } from './terminal';
import { observeCliModels } from './cliModelIdentity';
import { deleteFile, gitStatus, readFile, scanTree, writeFile } from './workspace';
import { addLessons, deleteLesson, indexLessons, LESSONS_FILE, lessonsFor, loadLessons, memoryContext, MemoryError, searchLessons, updateLesson, type LessonInput } from './memory';
import { currentEmbedder, embeddingStatus, forgetEmbedder, pullModel } from './embeddings';

const MAX_BODY = 8 * 1024 * 1024;

const PROJECT_MARKERS = ['.git', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'requirements.txt', 'composer.json', 'Gemfile', 'CMakeLists.txt', 'Makefile'];

function expandHome(p: string): string {
  return p.replace(/^~(?=$|\/)/, os.homedir());
}

function safeIsDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function rememberWorkspace(target: string) {
  updateConfig((cfg) => {
    cfg.workspaceRoot = target;
    cfg.recentWorkspaces = [target, ...(cfg.recentWorkspaces ?? []).filter((p) => p !== target)].slice(0, 8);
  });
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Request body too large.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, 'Invalid JSON body.'));
      }
    });
    req.on('error', reject);
  });
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

// ------------------------------------------------------------------ model cache

const modelCache = new Map<ProviderId, ModelInfo[]>();

function isProviderId(v: unknown): v is ProviderId {
  return typeof v === 'string' && PROVIDERS.some((p) => p.id === v);
}

function publicConnection(id: ProviderId) {
  const conn = loadConfig().connections[id];
  if (!conn) return null;
  return {
    method: conn.method,
    connectedAt: conn.connectedAt,
    lastVerifiedAt: conn.lastVerifiedAt,
    lastError: conn.lastError,
    maskedKey: conn.method === 'api_key' ? maskSecret(conn.apiKey) : conn.method === 'env_key' ? maskSecret(envKeyFor(id)) : undefined,
    endpointUrl: conn.endpointUrl,
    cliBinary: conn.cliBinary,
  };
}

function buildConnection(id: ProviderId, body: Record<string, unknown>): StoredConnection {
  const desc = providerDescriptor(id)!;
  const method = String(body.method || '') as ConnectionMethod;
  if (!desc.methods.includes(method)) throw new HttpError(400, `${desc.name} does not support "${method}" connections.`);
  const conn: StoredConnection = { providerId: id, method, connectedAt: new Date().toISOString() };
  if (method === 'api_key') {
    const key = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    const existing = loadConfig().connections[id];
    if (key) conn.apiKey = key;
    else if (existing?.method === 'api_key' && existing.apiKey) conn.apiKey = existing.apiKey;
    else throw new HttpError(400, 'Enter an API key.');
  } else if (method === 'env_key') {
    if (!envKeyFor(id)) throw new HttpError(400, `None of ${desc.envVars.join(', ')} is set in the Agent HQ server environment.`);
  } else if (method === 'local_endpoint') {
    const url = String(body.endpointUrl || (id === 'magpie' ? magpieEndpoint() : desc.defaultEndpoint) || '').trim();
    try {
      const parsed = new URL(url);
      if (!/^https?:$/.test(parsed.protocol)) throw new Error();
    } catch {
      throw new HttpError(400, 'Enter a valid http(s) endpoint URL.');
    }
    conn.endpointUrl = url;
  } else if (method === 'cli') {
    conn.cliBinary = desc.cliBinary;
  }
  return conn;
}

async function ensureModels(id: ProviderId): Promise<ModelInfo[]> {
  const conn = loadConfig().connections[id];
  if (!conn) return [];
  if (conn.method === 'cli') return discoverModels(conn, getWorkspaceRoot());
  const cached = modelCache.get(id);
  if (cached) return cached;
  try {
    const models = await discoverModels(conn);
    modelCache.set(id, models);
    return models;
  } catch {
    return [];
  }
}

function resolveModelRef(ref: string): { conn: StoredConnection; model: string } {
  const idx = ref.indexOf(':');
  const providerId = ref.slice(0, idx);
  const model = ref.slice(idx + 1);
  if (idx <= 0 || !isProviderId(providerId) || !model) throw new HttpError(400, `Invalid model reference "${ref}".`);
  const conn = loadConfig().connections[providerId];
  if (!conn) throw new HttpError(409, `${providerDescriptor(providerId)?.name} is not connected. Connect it in Connections & Models.`);
  if (model.startsWith('cli:') !== (conn.method === 'cli')) {
    throw new HttpError(409, `Model ${model} does not match the current ${providerId} connection method (${conn.method}). Pick a model again.`);
  }
  return { conn, model };
}

// ------------------------------------------------------------------ handlers

type Handler = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void>;

const routes: Record<string, Handler> = {
  'GET /api/health': async (_req, res) => {
    send(res, 200, { ok: true, workspace: getWorkspaceRoot(), time: Date.now() });
  },

  'GET /api/connections': async (_req, res) => {
    const providers = await Promise.all(
      PROVIDERS.map(async (p) => ({
        id: p.id,
        name: p.name,
        methods: p.methods,
        envVars: p.envVars,
        envKeyPresent: Boolean(envKeyFor(p.id)),
        cliBinary: p.cliBinary,
        defaultEndpoint: p.id === 'magpie' ? magpieEndpoint() : p.defaultEndpoint,
        docsUrl: p.docsUrl,
        notes: p.notes,
        connection: publicConnection(p.id),
        models: await ensureModels(p.id),
      }))
    );
    send(res, 200, { ok: true, providers });
  },

  'GET /api/connections/detect': async (_req, res) => {
    const clis = await Promise.all(DETECTED_CLIS.map((b) => detectCli(b)));
    let ollama: { reachable: boolean; endpoint: string; models?: number; error?: string };
    const endpoint = process.env.OLLAMA_HOST ? `http://${process.env.OLLAMA_HOST.replace(/^https?:\/\//, '')}` : 'http://127.0.0.1:11434';
    try {
      const r = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(2500) });
      const data = (await r.json()) as { models?: unknown[] };
      ollama = { reachable: r.ok, endpoint, models: data.models?.length ?? 0 };
    } catch {
      ollama = { reachable: false, endpoint, error: 'Ollama is not running at this address.' };
    }
    const magpieBase = magpieEndpoint();
    let magpie: { reachable: boolean; endpoint: string; models?: number; error?: string };
    try {
      const r = await fetch(`${magpieBase}/v1/models`, {
        signal: AbortSignal.timeout(2500),
        headers: process.env.MAGPIE_API_KEY ? { authorization: `Bearer ${process.env.MAGPIE_API_KEY}` } : undefined,
      });
      const data = (await r.json()) as { data?: unknown[] };
      magpie = { reachable: r.ok, endpoint: magpieBase, models: data.data?.length ?? 0 };
    } catch {
      magpie = { reachable: false, endpoint: magpieBase, error: 'The Magpie gateway is not running at this address.' };
    }
    const installs = Object.fromEntries(
      Object.values(INSTALL_GUIDES).map((g) => [g.id, { name: g.name, command: installCommandFor(g.id, process.platform), url: g.url }])
    );
    send(res, 200, { ok: true, clis, ollama, magpie, installs });
  },

  'GET /api/terminal/sessions': async (_req, res) => {
    send(res, 200, { ok: true, sessions: listTerminals(), root: getWorkspaceRoot() });
  },

  'POST /api/terminal/sessions': async (req, res) => {
    const body = await readTerminalJson(req);
    try {
      send(res, 200, { ok: true, session: await createTerminal({ cwd: getWorkspaceRoot(), cols: body.cols, rows: body.rows }) });
    } catch (err) {
      throw asHttpError(err);
    }
  },

  'GET /api/terminal/stream': async (req, res, url) => {
    try {
      streamTerminal(req, res, url.searchParams.get('id'));
    } catch (err) {
      throw asHttpError(err);
    }
  },

  'POST /api/terminal/input': async (req, res) => {
    const body = await readTerminalJson(req);
    try {
      writeTerminal(body.id, body.data);
    } catch (err) {
      throw asHttpError(err);
    }
    send(res, 200, { ok: true });
  },

  'POST /api/terminal/resize': async (req, res) => {
    const body = await readTerminalJson(req);
    try {
      resizeTerminal(body.id, body.cols, body.rows);
    } catch (err) {
      throw asHttpError(err);
    }
    send(res, 200, { ok: true });
  },

  'POST /api/terminal/close': async (req, res) => {
    const body = await readTerminalJson(req);
    try {
      closeTerminal(body.id);
    } catch (err) {
      throw asHttpError(err);
    }
    send(res, 200, { ok: true });
  },

  'POST /api/workspace/open-terminal': async (req, res) => {
    const body = await readJson(req);
    const root = getWorkspaceRoot();
    let command: string | undefined;
    if (body.install !== undefined) {
      const id = String(body.install);
      command = installCommandFor(id, process.platform) ?? undefined;
      if (!command) throw new HttpError(400, 'There is no terminal install command for this tool on this system. Use its download page.');
    }
    const launch = buildTerminalLaunch({
      platform: process.platform as 'linux' | 'darwin' | 'win32',
      dir: root,
      shell: process.env.SHELL,
      command,
      preferred: process.env.TERMINAL,
      isAvailable: (bin) => Boolean(findOnPath(bin)),
    });
    if (!launch) throw new HttpError(501, 'No terminal emulator was found. Set the TERMINAL environment variable to yours.');
    const child = spawn(launch.command, launch.args, { cwd: launch.cwd, detached: true, stdio: 'ignore' });
    child.on('error', () => undefined);
    child.unref();
    send(res, 200, { ok: true, terminal: launch.command, cwd: root, command: command ?? null });
  },

  'POST /api/connections/test': async (req, res) => {
    const body = await readJson(req);
    if (!isProviderId(body.providerId)) throw new HttpError(400, 'Unknown provider.');
    const conn = buildConnection(body.providerId, body);
    try {
      const { models, detail } = await verifyConnection(conn, getWorkspaceRoot());
      send(res, 200, { ok: true, detail, models });
    } catch (err) {
      send(res, 200, { ok: false, error: (err as Error).message });
    }
  },

  'POST /api/connections/connect': async (req, res) => {
    const body = await readJson(req);
    if (!isProviderId(body.providerId)) throw new HttpError(400, 'Unknown provider.');
    const id = body.providerId;
    const conn = buildConnection(id, body);
    try {
      const { models, detail } = await verifyConnection(conn, getWorkspaceRoot());
      conn.lastVerifiedAt = new Date().toISOString();
      updateConfig((cfg) => {
        cfg.connections[id] = conn;
      });
      modelCache.set(id, models);
      send(res, 200, { ok: true, detail, connection: publicConnection(id), models });
    } catch (err) {
      send(res, 200, { ok: false, error: (err as Error).message });
    }
  },

  'POST /api/connections/disconnect': async (req, res) => {
    const body = await readJson(req);
    if (!isProviderId(body.providerId)) throw new HttpError(400, 'Unknown provider.');
    const id = body.providerId;
    updateConfig((cfg) => {
      delete cfg.connections[id];
    });
    modelCache.delete(id);
    send(res, 200, { ok: true });
  },

  /** Re-reads every connected provider's model list. No prompt is sent, so it costs nothing. */
  'POST /api/models/rescan': async (_req, res) => {
    const connections = loadConfig().connections;
    const results = await Promise.all(
      PROVIDERS.filter((p) => connections[p.id]).map(async (p) => {
        const conn = connections[p.id]!;
        try {
          const models = await discoverModels(conn, conn.method === 'cli' ? getWorkspaceRoot() : '');
          if (conn.method !== 'cli') modelCache.set(p.id, models);
          return { providerId: p.id, ok: true, count: models.length };
        } catch (err) {
          return { providerId: p.id, ok: false, error: (err as Error).message };
        }
      })
    );
    send(res, 200, { ok: true, results });
  },

  'POST /api/connections/refresh': async (req, res) => {
    const body = await readJson(req);
    if (!isProviderId(body.providerId)) throw new HttpError(400, 'Unknown provider.');
    const id = body.providerId;
    const conn = loadConfig().connections[id];
    if (!conn) throw new HttpError(404, 'Provider is not connected.');
    try {
      const { models } = conn.method === 'cli' && id === 'anthropic'
        ? await verifyConnection(conn, getWorkspaceRoot())
        : { models: await discoverModels(conn, getWorkspaceRoot()) };
      modelCache.set(id, models);
      updateConfig((cfg) => {
        const c = cfg.connections[id];
        if (c) {
          c.lastVerifiedAt = new Date().toISOString();
          delete c.lastError;
          if (conn.cliModelObservation) c.cliModelObservation = conn.cliModelObservation;
        }
      });
      send(res, 200, { ok: true, models, connection: publicConnection(id) });
    } catch (err) {
      const message = (err as Error).message;
      updateConfig((cfg) => {
        const c = cfg.connections[id];
        if (c) c.lastError = message;
      });
      send(res, 200, { ok: false, error: message, connection: publicConnection(id) });
    }
  },

  'POST /api/chat': async (req, res) => {
    const body = await readJson(req);
    const ref = String(body.model || '');
    const messages = Array.isArray(body.messages) ? (body.messages as ChatMessage[]) : [];
    if (!messages.length) throw new HttpError(400, 'No messages.');
    for (const m of messages) {
      if ((m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') throw new HttpError(400, 'Invalid message.');
    }
    const { conn, model } = resolveModelRef(ref);
    const cwd = getWorkspaceRoot();

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    const write = (ev: unknown) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    write({ type: 'start', model: ref, via: conn.method });
    try {
      const result = await chat({
        connection: conn,
        model,
        system: typeof body.system === 'string' ? body.system : undefined,
        messages,
        maxTokens: typeof body.maxTokens === 'number' ? body.maxTokens : undefined,
        cwd,
        signal: controller.signal,
        onDelta: (text) => write({ type: 'delta', text }),
      });
      const current = loadConfig().connections[conn.providerId];
      if (result.resolvedModels?.length && current?.method === conn.method && current?.connectedAt === conn.connectedAt) {
        updateConfig((cfg) => {
          const stored = cfg.connections[conn.providerId];
          if (stored) observeCliModels(stored, cwd, model, result.resolvedModels!);
        });
      }
      const models = result.resolvedModels?.length ? await ensureModels(conn.providerId) : undefined;
      write({ type: 'done', usage: result.usage ?? null, latencyMs: result.latencyMs, models });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') write({ type: 'error', message: (err as Error).message });
    }
    res.end();
  },

  'GET /api/memory': async (_req, res, url) => {
    const root = getWorkspaceRoot();
    const agentId = url.searchParams.get('agentId') || undefined;
    let lessons: ReturnType<typeof loadLessons> = [];
    let error: string | undefined;
    try {
      lessons = lessonsFor(loadLessons(root), agentId);
    } catch (err) {
      if (!(err instanceof MemoryError)) throw err;
      error = err.message;
    }
    send(res, 200, { ok: true, file: LESSONS_FILE, lessons, error });
  },

  'GET /api/memory/status': async (_req, res) => {
    forgetEmbedder();
    const { status } = await currentEmbedder();
    send(res, 200, { ok: true, embedding: status, mode: status.active ? 'hybrid' : 'keyword' });
  },

  'POST /api/memory/lessons': async (req, res) => {
    const body = await readJson(req);
    const inputs = Array.isArray(body.lessons) ? (body.lessons as LessonInput[]) : [];
    if (!inputs.length) throw new HttpError(400, 'No lessons to save.');
    send(res, 200, { ok: true, ...addLessons(getWorkspaceRoot(), inputs) });
  },

  'PATCH /api/memory/lesson': async (req, res) => {
    const body = await readJson(req);
    const patch = body.patch && typeof body.patch === 'object' ? (body.patch as Record<string, unknown>) : {};
    send(res, 200, { ok: true, lesson: updateLesson(getWorkspaceRoot(), String(body.id || ''), patch) });
  },

  'DELETE /api/memory/lesson': async (req, res) => {
    const body = await readJson(req);
    deleteLesson(getWorkspaceRoot(), String(body.id || ''));
    send(res, 200, { ok: true });
  },

  'POST /api/memory/search': async (req, res) => {
    const body = await readJson(req);
    const root = getWorkspaceRoot();
    const query = String(body.query || '').slice(0, 4000);
    const candidates = lessonsFor(loadLessons(root), typeof body.agentId === 'string' && body.agentId ? body.agentId : undefined);
    const { embedder } = await currentEmbedder();
    const limit = Math.min(Math.max(Number(body.limit) || 8, 1), 50);
    send(res, 200, { ok: true, ...(await searchLessons(root, candidates, query, embedder, limit)) });
  },

  'POST /api/memory/context': async (req, res) => {
    const body = await readJson(req);
    const agentId = String(body.agentId || '');
    if (!agentId) throw new HttpError(400, 'Which agent is the context for?');
    const { embedder } = await currentEmbedder();
    const result = await memoryContext(getWorkspaceRoot(), { agentId, query: String(body.query || '').slice(0, 8000), budgetChars: Number(body.budgetChars) || undefined }, embedder);
    send(res, 200, { ok: true, ...result });
  },

  'POST /api/memory/embedding': async (req, res) => {
    const body = await readJson(req);
    const model = String(body.model || 'auto').trim();
    if (!/^[A-Za-z0-9._:/-]{1,100}$/.test(model)) throw new HttpError(400, 'That is not a model name.');
    updateConfig((cfg) => {
      cfg.memory = { ...cfg.memory, embeddingModel: model };
    });
    forgetEmbedder();
    const status = await embeddingStatus();
    send(res, 200, { ok: true, embedding: status, mode: status.active ? 'hybrid' : 'keyword' });
  },

  'POST /api/memory/reindex': async (_req, res) => {
    const root = getWorkspaceRoot();
    forgetEmbedder();
    const { embedder, status } = await currentEmbedder();
    if (!embedder) throw new HttpError(409, status.reachable ? 'No embedding model is installed in Ollama.' : `Ollama is not reachable at ${status.endpoint}.`);
    const lessons = loadLessons(root);
    const started = Date.now();
    try {
      await indexLessons(root, lessons, embedder);
    } catch (err) {
      throw new HttpError(502, (err as Error).message);
    }
    send(res, 200, { ok: true, indexed: lessons.length, model: embedder.model, durationMs: Date.now() - started });
  },

  'POST /api/memory/embedding/pull': async (req, res) => {
    const body = await readJson(req);
    const model = String(body.model || '').trim();
    if (!/^[A-Za-z0-9._:/-]{1,100}$/.test(model)) throw new HttpError(400, 'That is not a model name.');
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.flushHeaders?.();
    const write = (ev: unknown) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      await pullModel(model, (ev) => write({ type: 'progress', ...ev }), controller.signal);
      const status = await embeddingStatus();
      write({ type: 'done', embedding: status, mode: status.active ? 'hybrid' : 'keyword' });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') write({ type: 'error', message: (err as Error).message });
    }
    res.end();
  },

  'GET /api/workspace': async (_req, res) => {
    const cfg = loadConfig();
    send(res, 200, {
      ok: true,
      root: getWorkspaceRoot(),
      name: path.basename(getWorkspaceRoot()),
      lockedByEnv: Boolean(process.env.AGENT_HQ_WORKSPACE),
      recent: cfg.recentWorkspaces ?? [],
    });
  },

  'POST /api/workspace/root': async (req, res) => {
    if (process.env.AGENT_HQ_WORKSPACE) throw new HttpError(409, 'The workspace is fixed by the AGENT_HQ_WORKSPACE environment variable.');
    const body = await readJson(req);
    const target = path.resolve(expandHome(String(body.path || '')));
    if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) throw new HttpError(400, `Folder not found: ${target}`);
    rememberWorkspace(target);
    send(res, 200, { ok: true, root: target, name: path.basename(target) });
  },

  'GET /api/fs/browse': async (_req, res, url) => {
    const requested = url.searchParams.get('path');
    const showHidden = url.searchParams.get('hidden') === '1';
    const dir = path.resolve(expandHome(requested || os.homedir()));
    let entries: fs.Dirent[];
    try {
      if (!fs.statSync(dir).isDirectory()) throw new Error('not a folder');
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      throw new HttpError(400, `Cannot open folder: ${dir}`);
    }
    const dirs = entries
      .filter((e) => (e.isDirectory() || (e.isSymbolicLink() && safeIsDir(path.join(dir, e.name)))) && (showHidden || !e.name.startsWith('.')) && e.name !== 'node_modules')
      .map((e) => {
        const full = path.join(dir, e.name);
        return { name: e.name, path: full, isProject: PROJECT_MARKERS.some((m) => fs.existsSync(path.join(full, m))) };
      })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    const parent = path.dirname(dir);
    send(res, 200, {
      ok: true,
      path: dir,
      parent: parent !== dir ? parent : null,
      home: os.homedir(),
      isProject: PROJECT_MARKERS.some((m) => fs.existsSync(path.join(dir, m))),
      dirs: dirs.slice(0, 500),
      truncated: dirs.length > 500,
    });
  },

  'POST /api/workspace/create': async (req, res) => {
    if (process.env.AGENT_HQ_WORKSPACE) throw new HttpError(409, 'The workspace is fixed by the AGENT_HQ_WORKSPACE environment variable.');
    const body = await readJson(req);
    const name = String(body.name || '').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,79}$/.test(name) || name.includes('..')) {
      throw new HttpError(400, 'Use a project name made of letters, numbers, spaces, dots, dashes or underscores.');
    }
    const parent = path.resolve(expandHome(String(body.parent || os.homedir())));
    if (!safeIsDir(parent)) throw new HttpError(400, `Parent folder not found: ${parent}`);
    const target = path.join(parent, name);
    if (fs.existsSync(target)) throw new HttpError(409, `A file or folder named "${name}" already exists in ${parent}.`);
    fs.mkdirSync(target);
    let git = 'skipped';
    if (body.gitInit) {
      git = await new Promise<string>((resolve) =>
        execFile('git', ['init', '-q'], { cwd: target, timeout: 10_000 }, (err) => resolve(err ? `git init failed: ${err.message}` : 'initialized'))
      );
    }
    if (typeof body.description === 'string' && body.description.trim()) {
      fs.writeFileSync(path.join(target, 'README.md'), `# ${name}\n\n${body.description.trim()}\n`);
    }
    rememberWorkspace(target);
    send(res, 200, { ok: true, root: target, name, git });
  },

  'GET /api/workspace/files': async (_req, res) => {
    const root = getWorkspaceRoot();
    const { entries, truncated } = scanTree(root);
    send(res, 200, { ok: true, root, files: entries, truncated });
  },

  'GET /api/workspace/file': async (_req, res, url) => {
    const rel = url.searchParams.get('path') || '';
    if (url.searchParams.get('optional') === '1') {
      const full = resolveInside(getWorkspaceRoot(), rel);
      if (full && !fs.existsSync(full)) {
        send(res, 200, { ok: true, path: rel, exists: false, content: '', size: 0, binary: false });
        return;
      }
    }
    try {
      send(res, 200, { ok: true, path: rel, exists: true, ...readFile(getWorkspaceRoot(), rel) });
    } catch (err) {
      throw new HttpError(404, (err as Error).message);
    }
  },

  'PUT /api/workspace/file': async (req, res) => {
    const body = await readJson(req);
    if (typeof body.path !== 'string' || typeof body.content !== 'string') throw new HttpError(400, 'path and content are required.');
    try {
      const out = writeFile(getWorkspaceRoot(), body.path, body.content, { overwrite: body.overwrite !== false });
      send(res, 200, { ok: true, path: body.path, ...out });
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  },

  'DELETE /api/workspace/file': async (req, res) => {
    const body = await readJson(req);
    if (typeof body.path !== 'string') throw new HttpError(400, 'path is required.');
    try {
      deleteFile(getWorkspaceRoot(), body.path);
      send(res, 200, { ok: true, path: body.path });
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  },

  'POST /api/workspace/upload': async (req, res) => {
    const body = await readJson(req);
    const files = Array.isArray(body.files) ? (body.files as Array<{ path?: string; content?: string }>) : [];
    const saved: string[] = [];
    const errors: string[] = [];
    for (const f of files) {
      if (typeof f.path !== 'string' || typeof f.content !== 'string') continue;
      try {
        writeFile(getWorkspaceRoot(), f.path, f.content, { overwrite: Boolean(body.overwrite) });
        saved.push(f.path);
      } catch (err) {
        errors.push(`${f.path}: ${(err as Error).message}`);
      }
    }
    send(res, 200, { ok: errors.length === 0, saved, errors });
  },

  'GET /api/workspace/git': async (_req, res) => {
    send(res, 200, { ok: true, ...(await gitStatus(getWorkspaceRoot())) });
  },

  'GET /api/workspace/allowed-commands': async (_req, res) => {
    send(res, 200, { ok: true, commands: ALLOWED_COMMANDS });
  },

  'POST /api/workspace/execute': async (req, res) => {
    const body = await readJson(req);
    const command = String(body.command || '');
    const parsed = parseAllowedCommand(command);
    if (!parsed.ok) {
      send(res, 200, { ok: false, rejected: true, command, stdout: '', stderr: parsed.error, exitCode: null, durationMs: 0 });
      return;
    }
    const start = Date.now();
    const child = spawn(parsed.program!, parsed.args!, { cwd: getWorkspaceRoot(), env: { ...process.env, FORCE_COLOR: '0', CI: '1' } });
    let stdout = '';
    let stderr = '';
    const limit = 512 * 1024;
    child.stdout.on('data', (d) => (stdout = (stdout + d).slice(-limit)));
    child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-limit)));
    const timeoutMs = Math.min(Number(body.timeoutMs) || 120_000, 600_000);
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    res.on('close', () => {
      if (!res.writableEnded) child.kill('SIGTERM');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      send(res, 200, { ok: false, command, stdout, stderr: err.message, exitCode: null, durationMs: Date.now() - start });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (res.writableEnded) return;
      send(res, 200, {
        ok: code === 0,
        command,
        stdout,
        stderr: signal ? `${stderr}\n[terminated: ${signal}]` : stderr,
        exitCode: code,
        durationMs: Date.now() - start,
      });
    });
  },
};

function asHttpError(err: unknown): Error {
  return err instanceof TerminalError ? new HttpError(err.status, err.message) : (err as Error);
}

async function readTerminalJson(req: IncomingMessage) {
  if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'Terminal requests must be sent as JSON.');
  }
  return readJson(req);
}

export function createApiMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return next();
    if (!isLoopbackRequest(req)) {
      send(res, 403, { ok: false, error: 'The Agent HQ API only accepts requests from this machine.' });
      return;
    }
    const handler = routes[`${req.method} ${url.pathname}`];
    if (!handler) {
      send(res, 404, { ok: false, error: `No route for ${req.method} ${url.pathname}` });
      return;
    }
    try {
      await handler(req, res, url);
    } catch (err) {
      const status = err instanceof HttpError || err instanceof MemoryError ? err.status : 500;
      if (!res.headersSent) send(res, status, { ok: false, error: (err as Error).message });
      else res.end();
    }
  };
}
