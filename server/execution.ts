import fs from 'node:fs';
import path from 'node:path';

export function projectCommand(program: string, root: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): { program: string; env: NodeJS.ProcessEnv } {
  if (program !== 'python' && program !== 'python3') return { program, env };
  const delimiter = platform === 'win32' ? ';' : ':';
  for (const name of ['.venv', 'venv']) {
    const directory = path.join(root, name);
    const bin = path.join(directory, platform === 'win32' ? 'Scripts' : 'bin');
    const interpreter = path.join(bin, platform === 'win32' ? 'python.exe' : program);
    try {
      fs.accessSync(interpreter, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
      if (!fs.statSync(interpreter).isFile()) continue;
      return {
        program: interpreter,
        env: { ...env, VIRTUAL_ENV: directory, PATH: `${bin}${env.PATH ? delimiter + env.PATH : ''}` },
      };
    } catch {
      continue;
    }
  }
  return { program, env };
}

/**
 * Resolves `npm`/`npx` on Windows to Node executing the bundled CLI script so
 * `spawn(..., { shell: false })` works without invoking `.cmd` shims.
 */
export function resolveSpawnTarget(
  program: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  execPath = process.execPath,
): { program: string; args: string[] } {
  if (platform !== 'win32' || (program !== 'npm' && program !== 'npx')) {
    return { program, args };
  }
  const script = `${program}-cli.js`;
  const pathEntries = (env.PATH ?? env.Path ?? '').split(';').filter(Boolean);
  const dirs = [path.dirname(execPath), path.resolve(path.dirname(execPath), '..'), ...pathEntries];
  for (const dir of dirs) {
    const cliJs = path.join(dir, 'node_modules', 'npm', 'bin', script);
    if (fs.existsSync(cliJs)) return { program: execPath, args: [cliJs, ...args] };
  }
  return { program, args };
}
