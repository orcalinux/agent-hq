// The desktop app against the Vite dev server, with hot reload for the UI.
// Main-process and server changes need a restart of this command.
import { spawn } from 'child_process';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const port = Number(process.env.AGENT_HQ_DEV_PORT) || 5173;
const url = `http://127.0.0.1:${port}`;

const run = (cmd, args, env = {}) => spawn(cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
const done = (child) => new Promise((resolve, reject) => child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`)))));

await done(run(process.execPath, ['scripts/build-electron.mjs']));
const vite = run(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--port', String(port), '--strictPort']);

for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(`${url}/api/health`)).ok) break;
  } catch {
    // not up yet
  }
  await new Promise((r) => setTimeout(r, 200));
}

const electron = run(require('electron'), ['.'], { AGENT_HQ_DEV_URL: url });
const stop = () => {
  electron.kill();
  vite.kill();
};
electron.on('exit', () => {
  vite.kill();
  process.exit(0);
});
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
