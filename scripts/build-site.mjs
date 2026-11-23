#!/usr/bin/env node
// Builds the static site into site-dist/: stamps the version from package.json and copies the screenshots it uses.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, 'site-dist');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
let html = fs.readFileSync(path.join(root, 'site', 'index.html'), 'utf8').replaceAll('{{VERSION}}', version);
for (const name of ['style.css', 'app.js']) {
  const contents = fs.readFileSync(path.join(root, 'site', name));
  const hash = createHash('sha256').update(contents).digest('hex').slice(0, 12);
  fs.writeFileSync(path.join(out, name), contents);
  html = html.replaceAll(name, `${name}?v=${hash}`);
}
fs.writeFileSync(path.join(out, 'index.html'), html);
for (const name of ['workspace', 'tasks', 'office', 'growth']) {
  fs.copyFileSync(path.join(root, 'docs', 'screenshots', `${name}.png`), path.join(out, 'assets', `${name}.png`));
}
fs.copyFileSync(path.join(root, 'docs', 'social-preview.png'), path.join(out, 'assets', 'social-preview.png'));
fs.copyFileSync(path.join(root, 'build', 'icons', '128x128.png'), path.join(out, 'assets', 'icon.png'));
console.log(`site-dist built for v${version}`);
