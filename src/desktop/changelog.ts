export interface ReleaseSection {
  title: string;
  items: string[];
}

export interface Release {
  version: string;
  date?: string;
  /** Text under the version heading that is not in a section. */
  summary?: string;
  sections: ReleaseSection[];
}

/** Compares dotted versions numerically: 0.10.0 is newer than 0.9.0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, '').split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Reads CHANGELOG.md ("## [1.2.3] — date", "### Added", "- item") into releases, newest first. */
export function parseChangelog(markdown: string): Release[] {
  const releases: Release[] = [];
  let release: Release | null = null;
  let section: ReleaseSection | null = null;
  let item: { list: string[]; at: number } | null = null;
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const head = /^##\s+\[?v?(\d+\.\d+\.\d+[^\]\s]*)\]?(?:\s*[—–-]\s*(.+))?$/.exec(line);
    if (head) {
      release = { version: head[1], date: head[2]?.trim(), sections: [] };
      releases.push(release);
      section = null;
      item = null;
      continue;
    }
    if (/^##\s/.test(line)) {
      release = null;
      continue;
    }
    if (!release || /^\[[^\]]+\]:\s/.test(line)) continue;
    const sub = /^###\s+(.+)$/.exec(line);
    if (sub) {
      section = { title: sub[1].trim(), items: [] };
      release.sections.push(section);
      item = null;
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      if (!section) {
        section = { title: 'Changes', items: [] };
        release.sections.push(section);
      }
      section.items.push(bullet[1].trim());
      item = { list: section.items, at: section.items.length - 1 };
      continue;
    }
    if (!line.trim()) {
      item = null;
      continue;
    }
    if (item && /^\s{2,}\S/.test(raw)) {
      item.list[item.at] += ' ' + line.trim();
      continue;
    }
    if (!section) release.summary = release.summary ? `${release.summary} ${line.trim()}` : line.trim();
  }
  return releases;
}

/** Releases newer than `from` up to and including `to`, newest first. */
export function releasesBetween(releases: Release[], from: string | undefined, to: string): Release[] {
  return releases
    .filter((r) => compareVersions(r.version, to) <= 0 && (!from || compareVersions(r.version, from) > 0))
    .sort((a, b) => compareVersions(b.version, a.version));
}
