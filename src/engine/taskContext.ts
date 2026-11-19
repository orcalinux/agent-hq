const MAX_CONTEXT_FILES = 6;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function firstMention(text: string, token: string): number {
  const re = new RegExp(`(^|[^A-Za-z0-9_./-])${escapeRegExp(token)}(?![A-Za-z0-9_-])`);
  const m = re.exec(text);
  return m ? m.index + m[1].length : -1;
}

/**
 * Finds workspace files a task refers to, either by relative path or by a file name that
 * is unique in the workspace (for example "App.tsx"). Ordered by first mention.
 */
export function selectRelevantFiles(text: string, files: string[], max = MAX_CONTEXT_FILES): string[] {
  if (!text || !files.length) return [];
  const basenameCount = new Map<string, number>();
  for (const f of files) {
    const base = f.slice(f.lastIndexOf('/') + 1);
    basenameCount.set(base, (basenameCount.get(base) ?? 0) + 1);
  }
  const hits: Array<{ path: string; at: number }> = [];
  for (const f of files) {
    let at = firstMention(text, f);
    if (at < 0) {
      const base = f.slice(f.lastIndexOf('/') + 1);
      if (basenameCount.get(base) === 1 && base.includes('.') && base.length >= 4) at = firstMention(text, base);
    }
    if (at >= 0) hits.push({ path: f, at });
  }
  return hits
    .sort((a, b) => a.at - b.at || a.path.localeCompare(b.path))
    .slice(0, max)
    .map((h) => h.path);
}
