import { describe, expect, it } from 'vitest';
import { collapseContext, diffStats, lineDiff } from '@/utils/lineDiff';

const apply = (ops: ReturnType<typeof lineDiff>) => ops.filter((o) => o.kind !== 'del').map((o) => o.text).join('\n');
const undo = (ops: ReturnType<typeof lineDiff>) => ops.filter((o) => o.kind !== 'add').map((o) => o.text).join('\n');

describe('lineDiff', () => {
  it('shows only the changed lines as added or removed', () => {
    const ops = lineDiff('a\nb\nc\nd', 'a\nB\nc\nd\ne');
    expect(ops).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'del', text: 'b' },
      { kind: 'add', text: 'B' },
      { kind: 'same', text: 'c' },
      { kind: 'same', text: 'd' },
      { kind: 'add', text: 'e' },
    ]);
    expect(diffStats(ops)).toEqual({ added: 2, removed: 1 });
  });

  it('treats a missing file as all new lines', () => {
    expect(diffStats(lineDiff(null, 'x\ny'))).toEqual({ added: 2, removed: 0 });
  });

  it('always rebuilds both sides exactly', () => {
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let round = 0; round < 200; round++) {
      const lines = (n: number) => Array.from({ length: n }, () => 'l' + Math.floor(rand() * 6)).join('\n');
      const before = lines(Math.floor(rand() * 20) + 1);
      const after = lines(Math.floor(rand() * 20) + 1);
      const ops = lineDiff(before, after);
      expect(apply(ops)).toBe(after);
      expect(undo(ops)).toBe(before);
    }
  });

  it('stays correct on files too large for the table', () => {
    const before = Array.from({ length: 3000 }, (_, i) => `a${i}`).join('\n');
    const after = Array.from({ length: 3000 }, (_, i) => `b${i}`).join('\n');
    const ops = lineDiff(before, after);
    expect(apply(ops)).toBe(after);
    expect(undo(ops)).toBe(before);
  });

  it('folds long unchanged stretches into one gap', () => {
    const before = Array.from({ length: 40 }, (_, i) => `x${i}`).join('\n');
    const after = before.replace('x20', 'changed');
    const view = collapseContext(lineDiff(before, after), 2);
    expect(view[0]).toEqual({ kind: 'gap', count: 18 });
    expect(view.at(-1)).toEqual({ kind: 'gap', count: 17 });
    expect(view.filter((o) => o.kind !== 'gap')).toHaveLength(6);
  });
});
