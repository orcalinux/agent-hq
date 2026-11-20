// Bundles the desktop main process, its preload script and the standalone server into dist-electron/.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist-electron');
fs.rmSync(out, { recursive: true, force: true });

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: 'linked',
  logLevel: 'warning',
  absWorkingDir: root,
};

// Native PTY bindings load prebuilt binaries at runtime, so they stay out of the bundle.
const nativeModules = ['@lydell/node-pty'];

await Promise.all([
  build({ ...common, entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.cjs', external: ['electron', 'electron-updater', ...nativeModules] }),
  build({ ...common, entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.cjs', external: ['electron'], sourcemap: false }),
  build({ ...common, entryPoints: ['server/start.ts'], outfile: 'dist-electron/server.cjs', external: nativeModules }),
]);

fs.cpSync(path.join(root, 'electron/assets'), path.join(out, 'assets'), { recursive: true });
console.log('dist-electron: main.cjs, preload.cjs, server.cjs, assets/');
// The installed version's release notes, for What's new after an update, offline.
fs.copyFileSync(path.join(root, 'CHANGELOG.md'), path.join(out, 'CHANGELOG.md'));
