export type DiffOp = { kind: 'same' | 'add' | 'del'; text: string };

const MAX_CELLS = 4_000_000;

/** Line diff of `before` → `after`. Common ends are trimmed first; the middle uses an LCS table when it is small enough. */
export function lineDiff(before: string | null, after: string): DiffOp[] {
  const a = before === null || before === '' ? [] : before.split('\n');
  const b = after === '' ? [] : after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const head = a.slice(0, start).map((text) => ({ kind: 'same' as const, text }));
  const tail = a.slice(endA).map((text) => ({ kind: 'same' as const, text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const n = midA.length;
  const m = midB.length;
  if (n * m > MAX_CELLS) {
    return [...head, ...midA.map((text) => ({ kind: 'del' as const, text })), ...midB.map((text) => ({ kind: 'add' as const, text })), ...tail];
  }
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) table[i][j] = midA[i] === midB[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  }
  const mid: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (midA[i] === midB[j]) {
      mid.push({ kind: 'same', text: midA[i] });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) mid.push({ kind: 'del', text: midA[i++] });
    else mid.push({ kind: 'add', text: midB[j++] });
  }
  while (i < n) mid.push({ kind: 'del', text: midA[i++] });
  while (j < m) mid.push({ kind: 'add', text: midB[j++] });
  return [...head, ...mid, ...tail];
}

export function diffStats(ops: DiffOp[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.kind === 'add') added++;
    else if (op.kind === 'del') removed++;
  }
  return { added, removed };
}

/** Keeps changed lines plus `context` unchanged lines around them; long unchanged runs become a single gap marker. */
export function collapseContext(ops: DiffOp[], context = 3): Array<DiffOp | { kind: 'gap'; count: number }> {
  const keep = new Array<boolean>(ops.length).fill(false);
  ops.forEach((op, index) => {
    if (op.kind === 'same') return;
    for (let k = Math.max(0, index - context); k <= Math.min(ops.length - 1, index + context); k++) keep[k] = true;
  });
  const out: Array<DiffOp | { kind: 'gap'; count: number }> = [];
  let gap = 0;
  ops.forEach((op, index) => {
    if (keep[index]) {
      if (gap) out.push({ kind: 'gap', count: gap });
      gap = 0;
      out.push(op);
    } else gap++;
  });
  if (gap) out.push({ kind: 'gap', count: gap });
  return out;
}
