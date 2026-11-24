import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { loadConfig, updateConfig } from './config';
import { findOnPath } from './providers';
import { COMPUTER_TOOL_POLICY, validateComputerCall } from '../src/engine/computerPolicy';
import type { ComputerAccess, ComputerStatus, ComputerTool } from '../src/types/computerUse';

interface Daemon {
  child: ChildProcess;
  dir: string;
  socket: string;
  session: string;
  stderr: string;
}

let daemon: Daemon | null = null;
let lastFailure = '';
let starting: Promise<Daemon> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let setting: Promise<unknown> = Promise.resolve();
let epoch = 0;
let activeCall: AbortController | null = null;
const schemaCache = new Map<string, ComputerTool[]>();
const ENV = () => ({ ...process.env, CUA_DRIVER_RS_TELEMETRY_ENABLED: '0' });

export function computerAccessMode(): ComputerAccess {
  return loadConfig().computerAccess ?? 'off';
}

function driver(): string {
  const binary = findOnPath('cua-driver');
  if (!binary) throw new Error('Install Cua Driver to use local computer access.');
  return binary;
}

function run(args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(driver(), args, { timeout: 30_000, maxBuffer: 4 * 1024 * 1024, signal, env: ENV() },
      (error, stdout, stderr) => error ? reject(new Error(String(stdout).trim() || String(stderr).trim() || error.message)) : resolve(String(stdout)));
  });
}

function running(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null && !child.killed;
}

function alive(entry: Daemon | null): entry is Daemon {
  return !!entry && running(entry.child);
}

function socketReady(endpoint: string): Promise<boolean> {
  return new Promise((resolve) => {
    const connection = net.createConnection(endpoint);
    const done = (ready: boolean) => { connection.destroy(); resolve(ready); };
    connection.once('connect', () => done(true));
    connection.once('error', () => done(false));
    connection.setTimeout(100, () => done(false));
  });
}

function failureLine(text: string): string {
  return text.trim().split('\n').filter((line) => /error|fail|denied|refus/i.test(line)).pop()?.slice(0, 400) ?? '';
}

function terminate(entry: Daemon): void {
  if (!running(entry.child)) { fs.rmSync(entry.dir, { recursive: true, force: true }); return; }
  entry.child.kill('SIGTERM');
  setTimeout(() => { if (entry.child.exitCode === null && entry.child.signalCode === null) entry.child.kill('SIGKILL'); }, 2000).unref();
}

async function launch(): Promise<Daemon> {
  const binary = driver();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ahq-cua-'));
  fs.chmodSync(dir, 0o700);
  const socket = process.platform === 'win32' ? `\\\\.\\pipe\\agent-hq-cua-${process.pid}-${path.basename(dir)}` : path.join(dir, 'd.sock');
  const child = spawn(binary, ['serve', '--embedded', '--socket', socket, '--permission-mode', 'standard'], { stdio: ['ignore', 'ignore', 'pipe'], env: ENV() });
  const entry: Daemon = { child, dir, socket, session: `agent-hq-${crypto.randomBytes(6).toString('hex')}`, stderr: '' };
  child.stderr?.on('data', (data) => { entry.stderr = (entry.stderr + String(data)).slice(-4000); });
  child.on('error', (error) => { entry.stderr += `\nerror: ${error.message}`; });
  child.once('exit', (code, signal) => {
    fs.rmSync(dir, { recursive: true, force: true });
    if (daemon === entry) {
      daemon = null;
      lastFailure = `Cua Driver stopped unexpectedly (${signal ?? `exit ${code}`}). ${failureLine(entry.stderr)}`.trim();
    }
  });
  try {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (!running(entry.child)) throw new Error(failureLine(entry.stderr) || 'Cua Driver exited before it was ready.');
      if (await socketReady(socket)) {
        await run(['call', '--socket', socket, 'start_session', JSON.stringify({ session: entry.session })]);
        return entry;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(failureLine(entry.stderr) || 'Cua Driver did not become ready.');
  } catch (cause) {
    terminate(entry);
    throw cause;
  }
}

export async function startComputerDriver(): Promise<void> {
  if (alive(daemon)) return;
  if (!starting) {
    const generation = epoch;
    starting = launch()
      .then((entry) => {
        if (epoch !== generation) { terminate(entry); throw new Error('Desktop access stopped during startup.'); }
        daemon = entry; lastFailure = ''; return entry;
      })
      .catch((cause: Error) => { lastFailure = cause.message; throw cause; })
      .finally(() => { starting = null; });
  }
  await starting;
}

export function stopComputerDriver(): void {
  epoch++;
  activeCall?.abort();
  const entry = daemon;
  daemon = null;
  if (!entry) return;
  if (!running(entry.child)) { terminate(entry); return; }
  try {
    execFile(driver(), ['call', '--socket', entry.socket, 'end_session', JSON.stringify({ session: entry.session })], { timeout: 1500, env: ENV() }, () => terminate(entry));
  } catch {
    terminate(entry);
  }
}

export async function computerStatus(): Promise<ComputerStatus> {
  const mode = computerAccessMode();
  if (!findOnPath('cua-driver')) return { access: mode, installed: false, ready: false, running: false };
  try {
    const [version, report] = await Promise.all([run(['--version']), run(['doctor', '--json'])]);
    const doctor = JSON.parse(report) as { ok?: boolean; probes?: ComputerStatus['probes'] };
    return {
      access: mode, installed: true, version: version.trim().replace(/^cua-driver\s+/, ''), ready: doctor.ok === true, running: alive(daemon),
      probes: doctor.probes?.map(({ label, message, status }) => ({ label, message, status })), error: lastFailure || undefined,
    };
  } catch (cause) {
    return { access: mode, installed: true, ready: false, running: false, error: (cause as Error).message };
  }
}

async function changeAccess(mode: ComputerAccess): Promise<ComputerStatus> {
  if (mode !== 'off') {
    const status = await computerStatus();
    if (!status.installed) throw new Error('Install Cua Driver first.');
    if (!status.ready) throw new Error('Cua Driver is not ready. Check its diagnostics and OS permissions first.');
    await startComputerDriver();
  }
  updateConfig((config) => { config.computerAccess = mode; });
  if (mode === 'off') stopComputerDriver();
  return computerStatus();
}

export function setComputerAccess(mode: ComputerAccess): Promise<ComputerStatus> {
  const change = setting.catch(() => undefined).then(() => changeAccess(mode));
  setting = change;
  return change;
}

function trimSchema(name: string, schema: Record<string, unknown>): Record<string, unknown> {
  const policy = COMPUTER_TOOL_POLICY[name];
  const properties = (schema.properties ?? {}) as Record<string, unknown>;
  return {
    type: 'object',
    additionalProperties: false,
    properties: Object.fromEntries(policy.allowed.filter((key) => key in properties).map((key) => [key, properties[key]])),
    required: policy.required,
  };
}

export async function computerTools(): Promise<ComputerTool[]> {
  const mode = computerAccessMode();
  if (mode === 'off' || !findOnPath('cua-driver')) return [];
  const key = `${fs.realpathSync(driver())}@${(await run(['--version'])).trim()}`;
  let catalog = schemaCache.get(key);
  if (!catalog) {
    catalog = await Promise.all(Object.keys(COMPUTER_TOOL_POLICY).map(async (name) => {
      const text = await run(['describe', name]);
      const [head, body] = text.split('input_schema:\n');
      if (!body) throw new Error(`Cua Driver did not describe ${name}.`);
      const description = head.split('description:\n')[1]?.trim().split('\n')[0] ?? name;
      return { name, description, kind: COMPUTER_TOOL_POLICY[name].kind, schema: trimSchema(name, JSON.parse(body) as Record<string, unknown>) };
    }));
    schemaCache.set(key, catalog);
  }
  return catalog.filter((tool) => tool.kind === 'read' || mode === 'control');
}

export function callComputer(name: string, argumentsValue: unknown, signal?: AbortSignal): Promise<unknown> {
  validateComputerCall(computerAccessMode(), name, argumentsValue);
  const job = queue.catch(() => undefined).then(async () => {
    if (signal?.aborted) throw new Error('Cancelled before the computer tool ran.');
    validateComputerCall(computerAccessMode(), name, argumentsValue);
    await startComputerDriver();
    const entry = daemon;
    if (!alive(entry)) throw new Error('Cua Driver is not running.');
    const args: Record<string, unknown> = { ...(argumentsValue as Record<string, unknown>), session: entry.session };
    if (name === 'get_window_state') Object.assign(args, { include_screenshot: false, tree_format: 'markdown', timeout_ms: 3000, max_elements: Math.min(Number(args.max_elements) || 250, 250) });
    const controller = new AbortController();
    activeCall = controller;
    try {
      const raw = await run(['call', '--socket', entry.socket, name, JSON.stringify(args)], signal ? AbortSignal.any([signal, controller.signal]) : controller.signal);
      try { return JSON.parse(raw) as unknown; } catch { return { summary: raw.trim() }; }
    } finally {
      if (activeCall === controller) activeCall = null;
    }
  });
  queue = job;
  return job;
}
