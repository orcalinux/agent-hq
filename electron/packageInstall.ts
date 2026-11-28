import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { buildTerminalLaunch } from '../server/terminal';

export type PackageKind = 'deb' | 'rpm';

export interface InstallFailure {
  message: string;
  /** What to run in a terminal to install the same file by hand. */
  command: string;
  file: string;
}

export type InstallResult = { ok: true } | ({ ok: false } & InstallFailure);

const TEN_MINUTES = 10 * 60 * 1000;

const SESSION_ENV_KEYS = [
  'DISPLAY',
  'WAYLAND_DISPLAY',
  'XAUTHORITY',
  'XDG_RUNTIME_DIR',
  'DBUS_SESSION_BUS_ADDRESS',
  'XDG_SESSION_ID',
  'XDG_CURRENT_DESKTOP',
  'XDG_SESSION_TYPE',
  'DESKTOP_SESSION',
  'COLORTERM',
  'LANG',
] as const;

export function hasNoNewPrivs(statusPath = '/proc/self/status'): boolean {
  try {
    return /^NoNewPrivs:\s*1$/m.test(fs.readFileSync(statusPath, 'utf8'));
  } catch {
    return false;
  }
}

export function sessionEnvArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = [];
  for (const key of SESSION_ENV_KEYS) {
    const val = env[key];
    if (val && !/[\0\r\n]/.test(val)) out.push(`--setenv=${key}=${val}`);
  }
  return out;
}

export function canUseSystemdUser(
  searchPath = process.env.PATH ?? '',
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (process.platform !== 'linux') return null;
  const bin = findOnPath('systemd-run', searchPath);
  const rt = env.XDG_RUNTIME_DIR;
  if (!bin || !rt) return null;
  if (!fs.existsSync(path.join(rt, 'systemd', 'private')) && !fs.existsSync(path.join(rt, 'bus'))) {
    return null;
  }
  return bin;
}

export function packageKind(file: string): PackageKind | null {
  if (/\.deb$/i.test(file)) return 'deb';
  if (/\.rpm$/i.test(file)) return 'rpm';
  return null;
}

export function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/** The shell line that installs the package, with a fallback that repairs missing dependencies. */
export function installScript(kind: PackageKind, file: string): string {
  const quoted = shellQuote(file);
  return kind === 'deb'
    ? `dpkg -i ${quoted} || { apt-get install -f -y && dpkg -i ${quoted}; }`
    : `dnf -y install ${quoted} || rpm -U --replacepkgs ${quoted}`;
}

export function manualCommand(kind: PackageKind, file: string): string {
  const quoted = shellQuote(file);
  return kind === 'deb' ? `sudo dpkg -i ${quoted}` : `sudo dnf install ${quoted}`;
}

export function findOnPath(command: string, searchPath = process.env.PATH ?? ''): string | null {
  for (const dir of searchPath.split(path.delimiter)) {
    if (!dir || !path.isAbsolute(dir)) continue;
    const candidate = path.join(dir, command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/** A sentence for the person, from how the installer ended. */
export function failureMessage(input: { code: number | null; timedOut?: boolean; missing?: boolean; error?: string; stderr?: string }): string {
  if (input.missing) return 'No way to ask for administrator rights was found (pkexec is not installed).';
  if (input.timedOut) return 'The administrator prompt was not answered in time, so nothing was installed.';
  if (input.error) return `The installer could not start: ${input.error}`;
  if (input.code === 126) return 'The administrator prompt was cancelled, so nothing was installed.';
  const detail = input.stderr?.trim().split('\n').filter(Boolean).slice(-2).join(' ');
  if (input.code === 127) {
    return `Administrator authentication could not start, or the installer command was unavailable${detail ? ` (${detail})` : ''}. Try installing in a terminal.`;
  }
  return `The installer stopped with exit code ${input.code ?? 'unknown'}${detail ? `: ${detail}` : ''}.`;
}

export function terminalInstallCommand(kind: PackageKind, file: string, resultFile: string): string {
  return `sudo /bin/sh -c ${shellQuote(installScript(kind, file))}; result=$?; printf '%s' "$result" > ${shellQuote(resultFile)}; if [ "$result" -eq 0 ]; then printf '\\nUpdate installed. Agent HQ will restart.\\n'; else printf '\\nInstallation failed. You can try again in Agent HQ.\\n'; fi`;
}

export function runTerminalPackageInstall(
  file: string,
  options: { timeoutMs?: number; searchPath?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<InstallResult> {
  const kind = packageKind(file);
  const fail = (message: string): InstallResult => ({ ok: false, message, command: manualCommand(kind ?? 'deb', file), file });
  if (!kind || !fs.existsSync(file)) return Promise.resolve(fail('The downloaded update package is missing or unsupported. Download it again.'));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hq-install-'));
  const resultFile = path.join(directory, 'result');
  const launch = buildTerminalLaunch({
    platform: 'linux', dir: os.homedir(), shell: '/bin/sh',
    command: terminalInstallCommand(kind, file, resultFile),
    isAvailable: (binary) => Boolean(findOnPath(binary, options.searchPath)),
  });
  if (!launch) {
    fs.rmSync(directory, { recursive: true, force: true });
    return Promise.resolve(fail('No supported terminal was found. Copy the install command and run it in your terminal.'));
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: InstallResult) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timeout);
      fs.rmSync(directory, { recursive: true, force: true });
      resolve(result);
    };
    const poll = setInterval(() => {
      try {
        const result = fs.readFileSync(resultFile, 'utf8').trim();
        if (!/^\d+$/.test(result)) return;
        const code = Number(result);
        finish(code === 0 ? { ok: true } : fail(failureMessage({ code })));
      } catch {
        return;
      }
    }, 250);
    const timeout = setTimeout(() => finish(fail('The terminal did not report a completed installation. Check its output before trying again.')), options.timeoutMs ?? TEN_MINUTES);
    try {
      const terminalBin = findOnPath(launch.command, options.searchPath)!;
      const systemdRun = canUseSystemdUser(options.searchPath, options.env);
      const command = systemdRun ?? terminalBin;
      const args = systemdRun
        ? ['--user', '--collect', '--quiet', `--working-directory=${launch.cwd}`, ...sessionEnvArgs(options.env), '--', terminalBin, ...launch.args]
        : launch.args;
      const child = spawn(command, args, { cwd: launch.cwd, stdio: 'ignore', detached: true });
      child.once('error', (error) => finish(fail(`The terminal could not open: ${error.message}`)));
      child.unref();
    } catch (error) {
      finish(fail(`The terminal could not open: ${(error as Error).message}`));
    }
  });
}

export function relaunchLinuxApp(
  options: { oldPid?: number; execPath?: string; args?: string[]; searchPath?: string; env?: NodeJS.ProcessEnv } = {},
): boolean {
  const systemdRun = canUseSystemdUser(options.searchPath, options.env);
  if (!systemdRun) return false;
  const target = options.execPath ?? (fs.existsSync('/usr/bin/agent-hq') ? '/usr/bin/agent-hq' : process.execPath);
  const appArgs = options.args ?? process.argv.slice(1);
  const waitAndExec = 'i=0; while [ "$i" -lt 50 ] && kill -0 "$1" 2>/dev/null; do sleep 0.1; i=$((i+1)); done; shift; exec "$@"';
  try {
    const child = spawn(
      systemdRun,
      ['--user', '--collect', '--quiet', ...sessionEnvArgs(options.env), '--', '/bin/sh', '-c', waitAndExec, 'sh', String(options.oldPid ?? process.pid), target, ...appArgs],
      { detached: true, stdio: 'ignore' },
    );
    child.on('error', () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/**
 * Installs a downloaded .deb or .rpm without blocking the app. electron-updater runs this step
 * with spawnSync, which froze the whole app behind an invisible polkit prompt. On Linux systems
 * with NoNewPrivs: 1 (e.g. AppArmor/Chromium confinement), running pkexec through `systemd-run --user`
 * executes authentication in the clean user session so setuid root works reliably.
 */
export async function runPackageInstall(
  file: string,
  options: { timeoutMs?: number; isRoot?: boolean; searchPath?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<InstallResult> {
  const kind = packageKind(file);
  const fail = (message: string): InstallResult => ({ ok: false, message, command: manualCommand(kind ?? 'deb', file), file });
  if (!kind) return fail('This package type cannot be installed from the app.');
  if (!fs.existsSync(file)) return fail('The downloaded update file is missing. Download it again from Settings → Updates.');

  const script = installScript(kind, file);
  const isRoot = options.isRoot ?? process.getuid?.() === 0;
  const pkexec = isRoot ? null : findOnPath('pkexec', options.searchPath);
  if (!isRoot && !pkexec) return fail(failureMessage({ code: null, missing: true }));

  const systemdRun = isRoot ? null : canUseSystemdUser(options.searchPath, options.env);
  const runOnce = (viaSystemd: boolean) =>
    new Promise<{ code: number | null; timedOut: boolean; stderr: string; error?: string }>((resolve) => {
      let stderr = '';
      let timedOut = false;
      let settled = false;
      const done = (result: { code: number | null; timedOut: boolean; stderr: string; error?: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const command = isRoot
        ? '/bin/sh'
        : viaSystemd && systemdRun
          ? systemdRun
          : pkexec!;
      const args = isRoot
        ? ['-c', script]
        : viaSystemd && systemdRun
          ? ['--user', '--pipe', '--wait', '--collect', '--quiet', ...sessionEnvArgs(options.env), '--', pkexec!, '/bin/sh', '-c', script]
          : ['/bin/sh', '-c', script];
      const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, options.timeoutMs ?? TEN_MINUTES);
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-2000);
      });
      child.on('error', (error) => done({ code: null, timedOut, stderr, error: error.message }));
      child.on('close', (code) => done({ code, timedOut, stderr }));
    });

  let res = await runOnce(Boolean(systemdRun));
  if (systemdRun && !res.timedOut && res.code !== 0 && /Failed to connect|System has not been booted with systemd|Transport endpoint/i.test(res.stderr)) {
    res = await runOnce(false);
  }
  if (res.code === 0 && !res.timedOut) return { ok: true };
  return fail(failureMessage(res));
}
