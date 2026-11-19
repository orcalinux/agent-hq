export type TerminalPlatform = 'linux' | 'darwin' | 'win32';

export interface TerminalLaunch {
  command: string;
  args: string[];
  cwd: string;
}

export interface TerminalOptions {
  platform: TerminalPlatform;
  dir: string;
  shell?: string;
  /** A trusted command to run before the shell stays open. Never pass user input. */
  command?: string;
  preferred?: string;
  isAvailable: (binary: string) => boolean;
}

const LINUX_TERMINALS = ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xfce4-terminal', 'kitty', 'alacritty', 'wezterm', 'foot', 'xterm'];

function innerShell(shell: string, command?: string): string[] {
  return command ? [shell, '-lc', `${command}; exec "${shell}"`] : [shell];
}

function linuxArgs(binary: string, dir: string, inner: string[]): string[] {
  switch (binary) {
    case 'gnome-terminal':
      return ['--working-directory', dir, '--', ...inner];
    case 'konsole':
      return ['--workdir', dir, '-e', ...inner];
    case 'xfce4-terminal':
      return ['--working-directory', dir, '-x', ...inner];
    case 'kitty':
      return ['--directory', dir, ...inner];
    case 'alacritty':
      return ['--working-directory', dir, '-e', ...inner];
    case 'wezterm':
      return ['start', '--cwd', dir, '--', ...inner];
    case 'foot':
      return ['--working-directory', dir, ...inner];
    default:
      return ['-e', ...inner];
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Works out which terminal to open for this OS and how to start it in `dir`. Returns null when none is installed. */
export function buildTerminalLaunch(options: TerminalOptions): TerminalLaunch | null {
  const { platform, dir, command, isAvailable } = options;
  const shell = options.shell || (platform === 'win32' ? 'cmd' : '/bin/bash');

  if (platform === 'darwin') {
    if (!command) return { command: 'open', args: ['-a', 'Terminal', dir], cwd: dir };
    const script = `cd ${shellQuote(dir)} && ${command}`;
    return {
      command: 'osascript',
      args: ['-e', 'tell application "Terminal" to activate', '-e', `tell application "Terminal" to do script ${appleScriptString(script)}`],
      cwd: dir,
    };
  }

  if (platform === 'win32') {
    if (isAvailable('wt')) return { command: 'wt', args: ['-d', dir, ...(command ? ['cmd', '/k', command] : [])], cwd: dir };
    return { command: 'cmd', args: ['/c', 'start', '', 'cmd', '/k', command ?? 'cd .'], cwd: dir };
  }

  const inner = innerShell(shell, command);
  const candidates = [options.preferred, ...LINUX_TERMINALS].filter((entry): entry is string => Boolean(entry));
  for (const candidate of candidates) {
    if (!isAvailable(candidate)) continue;
    const base = candidate.split('/').pop() ?? candidate;
    return { command: candidate, args: linuxArgs(base, dir, inner), cwd: dir };
  }
  return null;
}
