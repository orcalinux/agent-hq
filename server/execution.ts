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
