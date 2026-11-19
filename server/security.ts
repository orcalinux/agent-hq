import fs from 'fs';
import path from 'path';
import type { IncomingMessage } from 'http';

export function isLoopbackRequest(req: IncomingMessage): boolean {
  const addr = req.socket.remoteAddress || '';
  const loopback =
    addr === '127.0.0.1' ||
    addr === '::1' ||
    addr === '::ffff:127.0.0.1' ||
    addr.startsWith('127.');
  if (!loopback) return false;
  const isLocalHost = (value: string) => {
    const host = value.replace(/^\[|\](:\d+)?$/g, '').replace(/:\d+$/, '');
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  };
  if (req.headers.host && !isLocalHost(req.headers.host)) return false;
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (!isLocalHost(new URL(origin).host)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** Resolves a user-supplied relative path inside root; returns null when it escapes the root. */
export function resolveInside(root: string, relativePath: string): string | null {
  if (!relativePath || relativePath.includes('\0')) return null;
  const resolved = path.resolve(root, relativePath);
  const rel = path.relative(root, resolved);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return realPathStaysInside(root, resolved) ? resolved : null;
}

function isWithin(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Follows symlinks on the deepest existing ancestor so links inside the workspace cannot point outside it. */
function realPathStaysInside(root: string, target: string): boolean {
  let realRoot: string;
  try {
    realRoot = fs.realpathSync(root);
  } catch {
    return false;
  }
  let probe = target;
  for (;;) {
    try {
      return isWithin(realRoot, fs.realpathSync(probe));
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) return false;
      probe = parent;
    }
  }
}

export const ALLOWED_COMMANDS: Array<{ program: string; subcommands?: string[]; description: string }> = [
  { program: 'git', subcommands: ['status', 'log', 'diff', 'branch', 'show', 'rev-parse'], description: 'Read-only git inspection' },
  { program: 'ls', description: 'List files' },
  { program: 'pwd', description: 'Print working directory' },
  { program: 'echo', description: 'Echo text' },
  { program: 'node', subcommands: ['-v', '--version'], description: 'Node version' },
  { program: 'npm', subcommands: ['-v', '--version', 'test', 'run', 'ls'], description: 'npm scripts and info' },
  { program: 'npx', subcommands: ['tsc', 'vitest', 'eslint', 'prettier'], description: 'Project tooling (installed packages only)' },
];

const SHELL_META = /[;&|`$<>(){}\\\n\r*?!~]/;

/** Options that make otherwise read-only programs write files or run configured helpers. */
const BLOCKED_OPTIONS: Record<string, RegExp> = {
  git: /^(--output|--ext-diff|--textconv|--exec|--upload-pack|--receive-pack|-o$)/,
};

function escapesWorkspace(value: string): boolean {
  return value.startsWith('/') || value.split('/').includes('..');
}

export interface ParsedCommand {
  ok: boolean;
  program?: string;
  args?: string[];
  error?: string;
}

/** Parses a terminal command line without a shell and checks it against the allowlist. */
export function parseAllowedCommand(commandLine: string): ParsedCommand {
  const trimmed = commandLine.trim();
  if (!trimmed) return { ok: false, error: 'Empty command.' };
  if (SHELL_META.test(trimmed)) {
    return {
      ok: false,
      error: 'Shell operators, globs, and substitutions are not allowed. Commands run without a shell.',
    };
  }
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trimmed))) tokens.push(m[1] ?? m[2] ?? m[3]);
  const [program, ...args] = tokens;
  const rule = ALLOWED_COMMANDS.find((r) => r.program === program);
  if (!rule) {
    return { ok: false, error: `"${program}" is not in the terminal allowlist.` };
  }
  if (rule.subcommands && !rule.subcommands.includes(args[0] ?? '')) {
    return {
      ok: false,
      error: `Only these "${program}" subcommands are allowed: ${rule.subcommands.join(', ')}.`,
    };
  }
  const blocked = BLOCKED_OPTIONS[program];
  const badOption = blocked && args.find((a) => blocked.test(a));
  if (badOption) {
    return { ok: false, error: `The "${badOption}" option is not allowed in the terminal.` };
  }
  if (args.some((a) => escapesWorkspace(a) || (a.startsWith('-') && a.includes('=') && escapesWorkspace(a.slice(a.indexOf('=') + 1))))) {
    return { ok: false, error: 'Arguments must stay inside the workspace (no absolute or parent paths).' };
  }
  if (program === 'npx') return { ok: true, program, args: ['--no', '--', ...args] };
  return { ok: true, program, args };
}
