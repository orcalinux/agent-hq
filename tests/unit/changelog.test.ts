import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { compareVersions, parseChangelog, releasesBetween } from '../../src/desktop/changelog';

const SAMPLE = `# Changelog

Intro text that is not a release.

## [0.3.0] — 2026-12-01

### Added
- **Updates** in the title bar.
- A long item
  that wraps onto a second line.

### Fixed
- A crash.

## [0.2.0] — 2026-11-20

Plain summary line.

## [0.1.0] — 2026-11-17

- A bullet with no section.

[0.3.0]: https://example.com
`;

describe('changelog', () => {
  it('compares versions numerically', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('1.2', '1.2.1')).toBeLessThan(0);
  });

  it('parses releases, sections, wrapped items and summaries', () => {
    const releases = parseChangelog(SAMPLE);
    expect(releases.map((r) => r.version)).toEqual(['0.3.0', '0.2.0', '0.1.0']);
    expect(releases[0].date).toBe('2026-12-01');
    expect(releases[0].sections.map((s) => s.title)).toEqual(['Added', 'Fixed']);
    expect(releases[0].sections[0].items[1]).toBe('A long item that wraps onto a second line.');
    expect(releases[1].summary).toBe('Plain summary line.');
    expect(releases[2].sections[0]).toEqual({ title: 'Changes', items: ['A bullet with no section.'] });
  });

  it('picks the releases between two versions, newest first', () => {
    const releases = parseChangelog(SAMPLE);
    expect(releasesBetween(releases, '0.1.0', '0.3.0').map((r) => r.version)).toEqual(['0.3.0', '0.2.0']);
    expect(releasesBetween(releases, undefined, '0.2.0').map((r) => r.version)).toEqual(['0.2.0', '0.1.0']);
    expect(releasesBetween(releases, '0.3.0', '0.3.0')).toEqual([]);
  });

  it('reads the project CHANGELOG with the current version in it', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    const releases = parseChangelog(readFileSync('CHANGELOG.md', 'utf8'));
    expect(releases[0].version).toBe(pkg.version);
    expect(releases[0].sections.length).toBeGreaterThan(0);
  });
});
