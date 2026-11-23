#!/usr/bin/env node
// Builds the static site into site-dist/: stamps the version from package.json and copies the screenshots it uses.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, 'site-dist');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
for (const name of ['style.css', 'app.js']) fs.copyFileSync(path.join(root, 'site', name), path.join(out, name));
fs.writeFileSync(path.join(out, 'index.html'), fs.readFileSync(path.join(root, 'site', 'index.html'), 'utf8').replaceAll('{{VERSION}}', version));
fs.copyFileSync(path.join(root, 'docs', 'screenshots', 'workspace.png'), path.join(out, 'assets', 'workspace.png'));
fs.copyFileSync(path.join(root, 'build', 'icons', '128x128.png'), path.join(out, 'assets', 'icon.png'));
console.log(`site-dist built for v${version}`);
