import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

interface PtyProcess {
  pid: number;
  onData(listener: (data: string) => void): unknown;
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): unknown;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}

interface PtyModule {
  spawn(file: string, args: string[], options: { name: string; cols: number; rows: number; cwd: string; env: Record<string, string> }): PtyProcess;
}

type Listener = (event: string, data: string) => void;

interface Session {
  id: string;
  title: string;
  shell: string;
  cwd: string;
  createdAt: number;
  proc: PtyProcess;
  backlog: string;
  exit: { code: number | null } | null;
  listeners: Set<Listener>;
}

export const MAX_SESSIONS = 8;
const MAX_BACKLOG = 256 * 1024;
const MAX_INPUT = 64 * 1024;

const sessions = new Map<string, Session>();
let ptyModule: Promise<PtyModule | null> | null = null;

function loadPty(): Promise<PtyModule | null> {
  ptyModule ??= import('@lydell/node-pty').then((mod) => (mod.default ?? mod) as unknown as PtyModule).catch(() => null);
  return ptyModule;
}

export class TerminalError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export function defaultShell(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
  if (platform === 'win32') return env.COMSPEC || 'powershell.exe';
  const configured = env.SHELL;
  if (configured && path.isAbsolute(configured) && fs.existsSync(configured)) return configured;
  return platform === 'darwin' ? '/bin/zsh' : fs.existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh';
}

export function clampSize(cols: unknown, rows: unknown): { cols: number; rows: number } {
  const toInt = (value: unknown, fallback: number) => (Number.isFinite(Number(value)) ? Math.round(Number(value)) : fallback);
  return { cols: Math.min(500, Math.max(10, toInt(cols, 80))), rows: Math.min(200, Math.max(2, toInt(rows, 24))) };
}

function describe(session: Session) {
  return {
    id: session.id,
    title: session.title,
    shell: path.basename(session.shell).replace(/\.exe$/i, ''),
    cwd: session.cwd,
    pid: session.proc.pid,
    createdAt: session.createdAt,
    exited: session.exit !== null,
    exitCode: session.exit?.code ?? null,
  };
}

export function listTerminals() {
  return Array.from(sessions.values()).map(describe);
}

export async function createTerminal(options: { cwd: string; cols?: unknown; rows?: unknown; shell?: string }) {
  if (sessions.size >= MAX_SESSIONS) throw new TerminalError(429, `At most ${MAX_SESSIONS} terminals can be open at once. Close one first.`);
  const pty = await loadPty();
  if (!pty) throw new TerminalError(501, 'The terminal engine could not be loaded on this system.');
  if (!fs.existsSync(options.cwd) || !fs.statSync(options.cwd).isDirectory()) throw new TerminalError(400, 'The project folder does not exist.');
  const shell = options.shell ?? defaultShell();
  const size = clampSize(options.cols, options.rows);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || key === 'ELECTRON_RUN_AS_NODE' || key.startsWith('ELECTRON_') || key === 'NODE_OPTIONS') continue;
    env[key] = value;
  }
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  env.TERM_PROGRAM = 'agent-hq';
  let proc: PtyProcess;
  try {
    proc = pty.spawn(shell, [], { name: 'xterm-256color', cols: size.cols, rows: size.rows, cwd: options.cwd, env });
  } catch (err) {
    throw new TerminalError(500, `Could not start ${path.basename(shell)}: ${(err as Error).message}`);
  }
  const session: Session = {
    id: randomUUID(),
    title: path.basename(shell).replace(/\.exe$/i, ''),
    shell,
    cwd: options.cwd,
    createdAt: Date.now(),
    proc,
    backlog: '',
    exit: null,
    listeners: new Set(),
  };
  proc.onData((data) => {
    session.backlog += data;
    if (session.backlog.length > MAX_BACKLOG) session.backlog = session.backlog.slice(session.backlog.length - MAX_BACKLOG);
    for (const listener of Array.from(session.listeners)) listener('data', data);
  });
  proc.onExit(({ exitCode }) => {
    session.exit = { code: exitCode };
    for (const listener of Array.from(session.listeners)) listener('exit', String(exitCode));
  });
  sessions.set(session.id, session);
  return describe(session);
}

function mustGet(id: unknown): Session {
  const session = typeof id === 'string' ? sessions.get(id) : undefined;
  if (!session) throw new TerminalError(404, 'That terminal is no longer running.');
  return session;
}

export function writeTerminal(id: unknown, data: unknown) {
  const session = mustGet(id);
  if (typeof data !== 'string') throw new TerminalError(400, 'Terminal input must be text.');
  if (data.length > MAX_INPUT) throw new TerminalError(413, 'That paste is too large for the terminal.');
  if (!session.exit) session.proc.write(data);
}

export function resizeTerminal(id: unknown, cols: unknown, rows: unknown) {
  const session = mustGet(id);
  const size = clampSize(cols, rows);
  if (!session.exit) session.proc.resize(size.cols, size.rows);
}

export function closeTerminal(id: unknown) {
  const session = mustGet(id);
  sessions.delete(session.id);
  for (const listener of Array.from(session.listeners)) listener('closed', '');
  session.listeners.clear();
  if (!session.exit) {
    try {
      session.proc.kill();
    } catch {
      /* already gone */
    }
  }
}

export function closeAllTerminals() {
  for (const id of Array.from(sessions.keys())) {
    try {
      closeTerminal(id);
    } catch {
      /* ignore */
    }
  }
}

export function streamTerminal(req: IncomingMessage, res: ServerResponse, id: unknown) {
  const session = mustGet(id);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const emit: Listener = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  if (session.backlog) emit('replay', session.backlog);
  if (session.exit) emit('exit', String(session.exit.code ?? ''));
  session.listeners.add(emit);
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => {
    clearInterval(keepAlive);
    session.listeners.delete(emit);
  });
  res.on('close', () => {
    clearInterval(keepAlive);
    session.listeners.delete(emit);
  });
}

process.once('exit', closeAllTerminals);
