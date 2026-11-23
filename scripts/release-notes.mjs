// Prints the CHANGELOG.md section of one version (default: package.json's), for the GitHub release body.
// Fails when the version has no section, so a release can't go out without its notes.
import fs from 'fs';

const version = (process.argv[2] || JSON.parse(fs.readFileSync('package.json', 'utf8')).version).replace(/^v/, '');
const lines = fs.readFileSync('CHANGELOG.md', 'utf8').split(/\r?\n/);
const start = lines.findIndex((line) => {
  const heading = /^##\s+(?:\[([^\]]+)\]|(\S+))(?:\s|$)/.exec(line);
  return (heading?.[1] ?? heading?.[2])?.replace(/^v/, '') === version;
});
if (start < 0) {
  console.error(`CHANGELOG.md has no section for ${version}.`);
  process.exit(1);
}
let end = lines.findIndex((l, i) => i > start && (/^##\s/.test(l) || /^\[[^\]]+\]:\s/.test(l)));
if (end < 0) end = lines.length;
const body = lines.slice(start + 1, end).join('\n').trim();
console.log(`${body}\n\n**Install:** AppImage, \`.deb\` (Debian/Ubuntu), \`.rpm\` (Fedora/RHEL), Windows and macOS below. Installed apps update themselves.`);
