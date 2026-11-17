/**
 * Resilient zero-dependency diff utilities.
 *  - `computeLineDiff(old, new)` : LCS-based line diff between two strings.
 *  - `parseUnifiedDiff(patch)`    : parse a unified diff (`@@ -a,b +c,d @@`) into lines.
 *  - `toSplitRows(lines)`          : pair deletions/additions for side-by-side rendering.
 */

export type DiffLineType = 'add' | 'del' | 'context' | 'hunk';

export interface DiffLine {
  type: DiffLineType;
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

export interface DiffStats {
  additions: number;
  deletions: number;
}

export interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

const MAX_LCS_CELLS = 4_000_000;

function splitLines(text: string): string[] {
  if (!text) return [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** LCS line diff. Falls back to a naive "all deleted then all added" diff for huge inputs. */
export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const n = a.length;
  const m = b.length;
  const out: DiffLine[] = [];

  if (n * m > MAX_LCS_CELLS) {
    a.forEach((content, i) => out.push({ type: 'del', content, oldLineNumber: i + 1, newLineNumber: null }));
    b.forEach((content, j) => out.push({ type: 'add', content, oldLineNumber: null, newLineNumber: j + 1 }));
    return out;
  }

  // dp[i][j] = LCS length of a[i..] and b[j..]
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'context', content: a[i], oldLineNumber: i + 1, newLineNumber: j + 1 });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'del', content: a[i], oldLineNumber: i + 1, newLineNumber: null });
      i++;
    } else {
      out.push({ type: 'add', content: b[j], oldLineNumber: null, newLineNumber: j + 1 });
      j++;
    }
  }
  while (i < n) {
    out.push({ type: 'del', content: a[i], oldLineNumber: i + 1, newLineNumber: null });
    i++;
  }
  while (j < m) {
    out.push({ type: 'add', content: b[j], oldLineNumber: null, newLineNumber: j + 1 });
    j++;
  }
  return out;
}

/** Parse unified diff text. Lines outside hunks (headers) are ignored. Plain text without hunks is treated as additions. */
export function parseUnifiedDiff(patch: string): DiffLine[] {
  const lines = splitLines(patch);
  const out: DiffLine[] = [];
  const hasHunk = lines.some((l) => l.startsWith('@@'));
  if (!hasHunk) {
    // Treat as +/- prefixed lines if present, else full-file addition
    let newNo = 1;
    let oldNo = 1;
    const prefixed = lines.some((l) => /^[+-]/.test(l)) && !lines.every((l) => !/^[+\- ]/.test(l));
    for (const line of lines) {
      if (prefixed && line.startsWith('+')) out.push({ type: 'add', content: line.slice(1), oldLineNumber: null, newLineNumber: newNo++ });
      else if (prefixed && line.startsWith('-')) out.push({ type: 'del', content: line.slice(1), oldLineNumber: oldNo++, newLineNumber: null });
      else if (prefixed) out.push({ type: 'context', content: line.startsWith(' ') ? line.slice(1) : line, oldLineNumber: oldNo++, newLineNumber: newNo++ });
      else out.push({ type: 'add', content: line, oldLineNumber: null, newLineNumber: newNo++ });
    }
    return out;
  }

  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  for (const line of lines) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
    if (header) {
      oldNo = parseInt(header[1], 10);
      newNo = parseInt(header[2], 10);
      inHunk = true;
      out.push({ type: 'hunk', content: line, oldLineNumber: null, newLineNumber: null });
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith('\\')) continue; // "\ No newline at end of file"
    if (line.startsWith('+')) out.push({ type: 'add', content: line.slice(1), oldLineNumber: null, newLineNumber: newNo++ });
    else if (line.startsWith('-')) out.push({ type: 'del', content: line.slice(1), oldLineNumber: oldNo++, newLineNumber: null });
    else out.push({ type: 'context', content: line.startsWith(' ') ? line.slice(1) : line, oldLineNumber: oldNo++, newLineNumber: newNo++ });
  }
  return out;
}

export function diffStats(lines: DiffLine[]): DiffStats {
  let additions = 0;
  let deletions = 0;
  for (const l of lines) {
    if (l.type === 'add') additions++;
    else if (l.type === 'del') deletions++;
  }
  return { additions, deletions };
}

/** Pair consecutive deletion/addition blocks for side-by-side rendering. */
export function toSplitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.type === 'context' || line.type === 'hunk') {
      rows.push({ left: line, right: line });
      i++;
      continue;
    }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i].type === 'del') dels.push(lines[i++]);
    while (i < lines.length && lines[i].type === 'add') adds.push(lines[i++]);
    const len = Math.max(dels.length, adds.length);
    for (let k = 0; k < len; k++) rows.push({ left: dels[k] ?? null, right: adds[k] ?? null });
  }
  return rows;
}

/** Collapse long runs of unchanged context lines, keeping `keep` lines around each change. */
export function collapseContext(lines: DiffLine[], keep = 3): (DiffLine | { type: 'collapsed'; count: number })[] {
  const out: (DiffLine | { type: 'collapsed'; count: number })[] = [];
  const isChange = lines.map((l) => l.type === 'add' || l.type === 'del' || l.type === 'hunk');
  const near = lines.map((_, idx) => {
    for (let k = Math.max(0, idx - keep); k <= Math.min(lines.length - 1, idx + keep); k++) if (isChange[k]) return true;
    return false;
  });
  let hidden = 0;
  lines.forEach((l, idx) => {
    if (near[idx] || !lines.some((_, k) => isChange[k])) {
      if (hidden > 0) {
        out.push({ type: 'collapsed', count: hidden });
        hidden = 0;
      }
      out.push(l);
    } else hidden++;
  });
  if (hidden > 0) out.push({ type: 'collapsed', count: hidden });
  return out;
}

// ------------------------------------------------------------------
// Lightweight syntax highlighter (token -> tailwind color class)
// ------------------------------------------------------------------

export interface SyntaxToken {
  text: string;
  className: string;
}

const KEYWORDS = new Set([
  'import', 'export', 'from', 'default', 'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
  'do', 'switch', 'case', 'break', 'continue', 'new', 'class', 'extends', 'implements', 'interface', 'type', 'enum',
  'async', 'await', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'in', 'of', 'as', 'public', 'private',
  'protected', 'readonly', 'static', 'void', 'null', 'undefined', 'true', 'false', 'this', 'super', 'yield', 'def',
  'self', 'None', 'True', 'False', 'elif', 'lambda', 'with', 'pass', 'raise', 'struct', 'impl', 'fn', 'pub', 'mut',
  'use', 'package', 'func', 'go', 'select', 'SELECT', 'FROM', 'WHERE', 'INSERT', 'UPDATE', 'CREATE', 'TABLE',
]);

const TOKEN_RE =
  /(\/\/.*$|#(?!\[).*$|\/\*.*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|(\s+)|([^\sA-Za-z_$\d"'`]+)/g;

export function highlightLine(line: string, language = 'ts'): SyntaxToken[] {
  const tokens: SyntaxToken[] = [];
  const hashComments = ['py', 'python', 'sh', 'bash', 'yaml', 'yml', 'toml', 'dockerfile'].includes(language.toLowerCase());
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  let lastWord = '';
  while ((match = TOKEN_RE.exec(line)) !== null) {
    const [text, comment, str, num, ident, ws] = match;
    if (comment !== undefined) {
      if (comment.startsWith('#') && !hashComments) {
        tokens.push({ text: '#', className: 'tok-punct' });
        TOKEN_RE.lastIndex = match.index + 1;
        continue;
      }
      tokens.push({ text, className: 'tok-comment' });
    } else if (str !== undefined) tokens.push({ text, className: 'tok-string' });
    else if (num !== undefined) tokens.push({ text, className: 'tok-number' });
    else if (ident !== undefined) {
      const next = line.slice(match.index + text.length).trimStart();
      if (KEYWORDS.has(ident)) tokens.push({ text, className: 'tok-keyword' });
      else if (next.startsWith('(')) tokens.push({ text, className: 'tok-fn' });
      else if (/^[A-Z]/.test(ident) || lastWord === 'type' || lastWord === 'interface') tokens.push({ text, className: 'tok-type' });
      else tokens.push({ text, className: 'tok-plain' });
      lastWord = ident;
    } else if (ws !== undefined) tokens.push({ text, className: '' });
    else tokens.push({ text, className: 'tok-punct' });
    if (text.length === 0) TOKEN_RE.lastIndex++;
  }
  return tokens;
}

export function languageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', mjs: 'js', py: 'python', rs: 'rust', go: 'go', sql: 'sql',
    json: 'json', css: 'css', md: 'markdown', yml: 'yaml', yaml: 'yaml', sh: 'bash', toml: 'toml', html: 'html',
  };
  return map[ext] ?? (path.toLowerCase().includes('dockerfile') ? 'dockerfile' : 'text');
}
