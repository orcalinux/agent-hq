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
  if (input.code === 127) return 'Administrator authentication could not start, or the installer command was unavailable. Try installing in a terminal.';
  const detail = input.stderr?.trim().split('\n').filter(Boolean).slice(-2).join(' ');
  return `The installer stopped with exit code ${input.code ?? 'unknown'}${detail ? `: ${detail}` : ''}.`;
}

export function terminalInstallCommand(kind: PackageKind, file: string, resultFile: string): string {
  return `sudo /bin/sh -c ${shellQuote(installScript(kind, file))}; result=$?; printf '%s' "$result" > ${shellQuote(resultFile)}; if [ "$result" -eq 0 ]; then printf '\\nUpdate installed. Agent HQ will restart.\\n'; else printf '\\nInstallation failed. You can try again in Agent HQ.\\n'; fi`;
}

export function runTerminalPackageInstall(
  file: string,
  options: { timeoutMs?: number; searchPath?: string } = {},
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
      const child = spawn(findOnPath(launch.command, options.searchPath)!, launch.args, { cwd: launch.cwd, stdio: 'ignore', detached: true });
      child.once('error', (error) => finish(fail(`The terminal could not open: ${error.message}`)));
      child.unref();
    } catch (error) {
      finish(fail(`The terminal could not open: ${(error as Error).message}`));
    }
  });
}

/**
 * Installs a downloaded .deb or .rpm without blocking the app. electron-updater runs this step
 * with spawnSync, which froze the whole app behind an invisible polkit prompt.
 */
export function runPackageInstall(
  file: string,
  options: { timeoutMs?: number; isRoot?: boolean; searchPath?: string } = {},
): Promise<InstallResult> {
  const kind = packageKind(file);
  const fail = (message: string): InstallResult => ({ ok: false, message, command: manualCommand(kind ?? 'deb', file), file });
  if (!kind) return Promise.resolve(fail('This package type cannot be installed from the app.'));
  if (!fs.existsSync(file)) return Promise.resolve(fail('The downloaded update file is missing. Download it again from Settings → Updates.'));

  const script = installScript(kind, file);
  const isRoot = options.isRoot ?? process.getuid?.() === 0;
  const pkexec = isRoot ? null : findOnPath('pkexec', options.searchPath);
  if (!isRoot && !pkexec) return Promise.resolve(fail(failureMessage({ code: null, missing: true })));

  return new Promise<InstallResult>((resolve) => {
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const done = (result: InstallResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const child = isRoot
      ? spawn('/bin/sh', ['-c', script], { stdio: ['ignore', 'ignore', 'pipe'] })
      : spawn(pkexec!, ['/bin/sh', '-c', script], { stdio: ['ignore', 'ignore', 'pipe'] });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, options.timeoutMs ?? TEN_MINUTES);
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    child.on('error', (error) => done(fail(failureMessage({ code: null, error: error.message }))));
    child.on('close', (code) => {
      if (code === 0 && !timedOut) done({ ok: true });
      else done(fail(failureMessage({ code, timedOut, stderr })));
    });
  });
}
