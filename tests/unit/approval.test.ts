import { describe, expect, it } from 'vitest';
import { APPROVAL_MODES, approvalModeInfo, autoAppliesChanges, autoStartsRuns, canRevert, markConflicts, selectAutoApply, blameTasks, verificationCouldNotRun } from '../../src/engine/approval';
import type { ProposedFileChange } from '../../src/types';

const change = (id: string, path: string, status: ProposedFileChange['status'] = 'pending', extra: Partial<ProposedFileChange> = {}): ProposedFileChange => ({
  id,
  path,
  content: id,
  taskId: id,
  agentId: 'agent-frontend',
  status,
  ...extra,
});

describe('approval modes', () => {
  it('only auto and full access write files without asking', () => {
    expect(autoAppliesChanges('ask')).toBe(false);
    expect(autoAppliesChanges('auto')).toBe(true);
    expect(autoAppliesChanges('full')).toBe(true);
  });

  it('only full access starts runs, and only for Build requests', () => {
    expect(autoStartsRuns('full', 'build')).toBe(true);
    expect(autoStartsRuns('full', 'plan')).toBe(false);
    expect(autoStartsRuns('full', 'ask')).toBe(false);
    expect(autoStartsRuns('auto', 'build')).toBe(false);
    expect(autoStartsRuns('ask', 'build')).toBe(false);
  });

  it('describes every mode and falls back to ask', () => {
    expect(APPROVAL_MODES.map((m) => m.id)).toEqual(['ask', 'auto', 'full']);
    expect(approvalModeInfo('nope' as never).id).toBe('ask');
  });
});

describe('selectAutoApply', () => {
  it('applies the latest pending proposal per path when it builds on the earlier one', () => {
    const { apply, superseded, conflicted } = selectAutoApply([
      change('a1', 'src/a.ts'),
      change('b1', 'src/b.ts'),
      change('a2', 'src/a.ts'),
      change('c1', 'src/c.ts', 'applied'),
      change('d1', 'src/d.ts', 'discarded'),
    ], [{ id: 'a1' }, { id: 'b1' }, { id: 'a2', dependsOn: ['a1'] }]);
    expect(apply.map((c) => c.id)).toEqual(['b1', 'a2']);
    expect(superseded.map((c) => c.id)).toEqual(['a1']);
    expect(conflicted).toEqual([]);
  });

  it('never auto-applies a file that independent tasks both changed', () => {
    const { apply, superseded, conflicted } = selectAutoApply(
      [change('a1', 'src/a.ts'), change('b1', 'src/a.ts'), change('c1', 'src/c.ts')],
      [{ id: 'a1' }, { id: 'b1' }, { id: 'c1' }],
    );
    expect(apply.map((c) => c.id)).toEqual(['c1']);
    expect(superseded).toEqual([]);
    expect(conflicted.map((c) => c.id)).toEqual(['a1', 'b1']);
  });

  it('returns nothing when no change is pending', () => {
    expect(selectAutoApply([change('x', 'x.ts', 'applied')])).toEqual({ apply: [], superseded: [], conflicted: [] });
  });
});

describe('canRevert', () => {
  it('needs an applied change with a known previous state', () => {
    expect(canRevert(change('a', 'a.ts', 'applied', { previousContent: 'old' }))).toBe(true);
    expect(canRevert(change('a', 'a.ts', 'applied', { previousContent: null }))).toBe(true);
    expect(canRevert(change('a', 'a.ts', 'applied'))).toBe(false);
    expect(canRevert(change('a', 'a.ts', 'pending', { previousContent: 'old' }))).toBe(false);
    expect(canRevert(change('a', 'a.ts', 'reverted', { previousContent: 'old' }))).toBe(false);
  });
});

describe('markConflicts', () => {
  it('flags parallel edits of one file and names the other task', () => {
    const marked = markConflicts([change('a', 'x.ts'), change('b', 'x.ts'), change('c', 'y.ts')], [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(marked.map((c) => c.conflictsWith)).toEqual([['b'], ['a'], undefined]);
  });

  it('does not flag a task that depends on the other, even indirectly', () => {
    const tasks = [{ id: 'a' }, { id: 'm', dependsOn: ['a'] }, { id: 'b', dependsOn: ['m'] }];
    expect(markConflicts([change('a', 'x.ts'), change('b', 'x.ts')], tasks).every((c) => !c.conflictsWith)).toBe(true);
  });

  it('clears the flag once the rival is no longer pending', () => {
    const tasks = [{ id: 'a' }, { id: 'b' }];
    const marked = markConflicts([change('a', 'x.ts', 'applied', { conflictsWith: ['b'] }), change('b', 'x.ts', 'discarded', { conflictsWith: ['a'] })], tasks);
    expect(marked.every((c) => !c.conflictsWith)).toBe(true);
  });

  it('survives a dependency cycle', () => {
    const tasks = [{ id: 'a', dependsOn: ['b'] }, { id: 'b', dependsOn: ['a'] }];
    expect(markConflicts([change('a', 'x.ts'), change('b', 'x.ts')], tasks).every((c) => !c.conflictsWith)).toBe(true);
  });
});

describe('blameTasks', () => {
  const tasks = [{ id: 't1' }, { id: 't2' }, { id: 't3' }];
  const changes = [
    { taskId: 't1', path: 'pkg/money.py', status: 'pending' },
    { taskId: 't2', path: 'pkg/storage.py', status: 'pending' },
    { taskId: 't3', path: 'pkg/cli.py', status: 'discarded' },
  ];

  it('blames the tasks whose files the failure output names', () => {
    expect(blameTasks('FAILED tests/test_x.py - storage.py:42 TypeError', changes, tasks)).toEqual([{ id: 't2' }]);
    expect(blameTasks('pkg/money.py:3: error', changes, tasks)).toEqual([{ id: 't1' }]);
  });

  it('falls back to every task that still has a proposal when no file is named', () => {
    expect(blameTasks('3 failed, 10 passed', changes, tasks)).toEqual([{ id: 't1' }, { id: 't2' }]);
  });

  it('falls back to all tasks when nothing is pending', () => {
    expect(blameTasks('boom', [], tasks)).toEqual(tasks);
  });
});

describe('verificationCouldNotRun', () => {
  it('recognises a missing runner', () => {
    expect(verificationCouldNotRun(1, '/usr/bin/python: No module named pytest')).toBe(true);
    expect(verificationCouldNotRun(127, '')).toBe(true);
    expect(verificationCouldNotRun(1, 'sh: 1: vitest: not found')).toBe(true);
    expect(verificationCouldNotRun(1, 'npm error Missing script: "test"')).toBe(true);
    expect(verificationCouldNotRun(1, 'Error: spawn cargo ENOENT')).toBe(true);
  });

  it('treats the project\'s own failures as real failures', () => {
    expect(verificationCouldNotRun(1, '3 failed, 10 passed')).toBe(false);
    expect(verificationCouldNotRun(1, "ModuleNotFoundError: No module named 'tabsplit.migrations'")).toBe(false);
    expect(verificationCouldNotRun(2, 'SyntaxError: invalid syntax')).toBe(false);
  });
});
