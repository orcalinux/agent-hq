import { describe, expect, it } from 'vitest';
import { APPROVAL_MODES, approvalModeInfo, autoAppliesChanges, autoStartsRuns, canRevert, checkpointProposals, evidencedQaIssues, finalFileDigest, markConflicts, qaIssueKey, replaceMergedProposals, runCreatedTests, selectAutoApply, blameTasks, reworkClosure, verificationCouldNotRun } from '../../src/engine/approval';
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

describe('verified candidate review', () => {
  const files = [change('t1', 'money.py', 'applied', { content: 'return int(amount) / rate\n' })];
  const issue = { taskId: 't1', problem: 'rate=0 divides by zero', path: 'money.py', evidence: 'int(amount) / rate' };

  it('keeps a rejection grounded in code actually written by the named task', () => {
    expect(evidencedQaIssues({ verdict: 'reject', summary: 'bug', issues: [issue] }, files)).toEqual([issue]);
  });

  it('does not treat hidden-test speculation or invented code as evidence', () => {
    expect(evidencedQaIssues({ verdict: 'reject', summary: 'cannot see hidden tests', issues: [
      { taskId: 't1', problem: 'need more tests' },
      { ...issue, evidence: 'invented code excerpt' },
      { ...issue, taskId: 't2' },
      { ...issue, path: 'other.py' },
      { ...issue, evidence: '' },
    ] }, files)).toEqual([]);
  });

  it('checks the latest applied revision and ignores pending or discarded content', () => {
    const revised = [...files, change('t2', 'money.py', 'applied', { content: 'return safe_divide(amount, rate)\n' })];
    expect(evidencedQaIssues({ verdict: 'reject', summary: 'old defect', issues: [issue] }, revised)).toEqual([]);
    expect(evidencedQaIssues({ verdict: 'reject', summary: 'unwritten defect', issues: [issue] }, [
      { ...files[0], status: 'pending' },
    ])).toEqual([]);
  });

  it('accepts a citation for either contributor to a merged file', () => {
    const merged = [{ ...files[0], sourceTaskIds: ['t1', 't2'] }];
    expect(evidencedQaIssues({ verdict: 'reject', summary: 'bug', issues: [{ ...issue, taskId: 't2' }] }, merged)).toHaveLength(1);
    expect(evidencedQaIssues({ verdict: 'reject', summary: 'bug', issues: [{ ...issue, taskId: 'invented' }] }, merged)).toHaveLength(0);
  });

  it('accepts a concrete defect in an unchanged file only after inspecting its current contents', () => {
    const verdict = { verdict: 'reject' as const, summary: 'entry point missed', issues: [issue] };
    expect(evidencedQaIssues(verdict, [])).toEqual([]);
    expect(evidencedQaIssues(verdict, [], [{ path: 'money.py', content: 'return int(amount) / rate\n' }])).toEqual([issue]);
    expect(evidencedQaIssues(verdict, [], [{ path: 'money.py', content: 'return safe_divide(amount, rate)\n' }])).toEqual([]);
  });

  it('infers the applied task id or preserves empty taskId on inspected files when evidence matches', () => {
    const appliedEmptyId = { ...issue, taskId: '' };
    expect(evidencedQaIssues({ verdict: 'reject', summary: 'bug', issues: [appliedEmptyId] }, files)).toEqual([issue]);
    expect(evidencedQaIssues({ verdict: 'reject', summary: 'bug', issues: [appliedEmptyId] }, [], [{ path: 'money.py', content: 'return int(amount) / rate\n' }])).toEqual([appliedEmptyId]);
    expect(evidencedQaIssues({ verdict: 'reject', summary: 'bug', issues: [{ ...issue, taskId: 'invented' }] }, files)).toEqual([]);
  });

  it('restores only the latest passing revision per file without mutating the checkpoint', () => {
    const checkpoint = [
      change('old', 'money.py', 'applied'),
      change('new', 'money.py', 'applied'),
      change('tests', 'test_money.py', 'applied'),
    ];
    const proposals = checkpointProposals(checkpoint);
    expect(proposals.map((entry) => entry.status)).toEqual(['discarded', 'pending', 'pending']);
    expect(selectAutoApply(proposals).apply.map((entry) => entry.id)).toEqual(['new', 'tests']);
    expect(checkpoint.every((entry) => entry.status === 'applied')).toBe(true);
  });
});

describe('final file digest for QA', () => {
  it('shows only the final version of each file, reworked files first', () => {
    const digest = finalFileDigest([
      change('t3', 'money.py', 'applied', { content: 'OLD \\d' }),
      change('t7', 'migration.py', 'applied', { content: 'migration v1' }),
      change('t8', 'money.py', 'applied', { content: 'NEW [0-9]' }),
      change('t9', 'skip.py', 'discarded', { content: 'never written' }),
    ], 10_000);
    expect(digest.text).toContain('NEW [0-9]');
    expect(digest.text).not.toContain('OLD');
    expect(digest.text).not.toContain('never written');
    expect(digest.text.indexOf('FILE money.py')).toBeLessThan(digest.text.indexOf('FILE migration.py'));
    expect(digest.omitted).toEqual([]);
  });

  it('names every file left out for space instead of silently cutting rework', () => {
    const digest = finalFileDigest([
      change('t1', 'big.py', 'applied', { content: 'x'.repeat(500) }),
      change('t2', 'fix.py', 'applied', { content: 'the rework' }),
    ], 200);
    expect(digest.text).toContain('the rework');
    expect(digest.omitted).toEqual(['big.py']);
  });

  it('identifies a repeated QA claim regardless of whitespace in the excerpt', () => {
    const issue = { taskId: 't7', problem: 'dup', path: 'migration.py', evidence: 'if mid in roster[gid]:' };
    expect(qaIssueKey({ ...issue, problem: 'reworded', evidence: '  if mid in\n roster[gid]:' })).toBe(qaIssueKey(issue));
    expect(qaIssueKey({ ...issue, path: 'cli.py' })).not.toBe(qaIssueKey(issue));
  });

  it('treats only tests created during the run as correctable, never pre-existing tests', () => {
    expect(runCreatedTests([
      change('t1', 'tests/test_api_currency.py', 'applied', { previousContent: null }),
      change('t2', 'tests/test_api_currency.py', 'applied', { previousContent: 'earlier run version' }),
      change('t3', 'tests/test_existing.py', 'applied', { previousContent: 'original contract' }),
      change('t4', 'src/money.test.ts', 'pending', { previousContent: null }),
      change('t5', 'tabsplit/migration.py', 'applied', { previousContent: null }),
      change('t6', 'pkg/parse_test.go', 'applied'),
    ])).toEqual(['src/money.test.ts', 'tests/test_api_currency.py']);
  });
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

describe('merging independent proposals', () => {
  const originals = [change('a', 'shared.py'), change('b', 'shared.py')];
  const merged = change('merged', 'shared.py', 'pending', { taskId: 'a', content: 'combined', sourceTaskIds: ['a', 'b'] });

  it('retains both originals and makes only the merged file eligible to apply', () => {
    const result = replaceMergedProposals(originals, originals, merged);
    expect(result.map((entry) => entry.status)).toEqual(['discarded', 'discarded', 'pending']);
    expect(result.slice(0, 2).map((entry) => entry.content)).toEqual(['a', 'b']);
    expect(selectAutoApply(result, [{ id: 'a' }, { id: 'b' }]).apply).toEqual([merged]);
    expect(originals.every((entry) => entry.status === 'pending')).toBe(true);
  });

  it('preserves unrelated files', () => {
    const unrelated = change('c', 'other.py');
    expect(replaceMergedProposals([...originals, unrelated], originals, merged)).toContain(unrelated);
  });

  it('rejects stale proposals and empty or unrelated merged files', () => {
    expect(() => replaceMergedProposals([{ ...originals[0], content: 'new' }, originals[1]], originals, merged)).toThrow('changed during integration');
    expect(() => replaceMergedProposals(originals, originals, { ...merged, content: '' })).toThrow('nonempty');
    expect(() => replaceMergedProposals(originals, originals, { ...merged, path: 'different.py' })).toThrow('matching every original');
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

describe('reworked dependency chains', () => {
  const chain = [{ id: 't5', dependsOn: [] }, { id: 't6', dependsOn: ['t5'] }, { id: 't7', dependsOn: ['t6'] }, { id: 't9', dependsOn: [] }];

  it('keep the version of the task that built on the file, even when an upstream task was reworked later', () => {
    const proposals = [
      change('t7-old', 'storage.py', 'pending', { taskId: 't7' }),
      change('t5-new', 'storage.py', 'pending', { taskId: 't5' }),
      change('t6-new', 'storage.py', 'pending', { taskId: 't6' }),
    ];
    const picked = selectAutoApply(proposals, chain);
    expect(picked.apply.map((c) => c.id)).toEqual(['t7-old']);
    expect(picked.superseded.map((c) => c.id).sort()).toEqual(['t5-new', 't6-new']);
    expect(selectAutoApply([change('a', 'x.py', 'pending', { taskId: 't5' }), change('b', 'x.py', 'pending', { taskId: 't5' })], chain).apply.map((c) => c.id)).toEqual(['b']);
  });

  it('redo dependent tasks that changed the same files as a task sent back', () => {
    const proposals = [
      change('a', 'storage.py', 'pending', { taskId: 't5' }),
      change('b', 'storage.py', 'pending', { taskId: 't6' }),
      change('c', 'storage.py', 'discarded', { taskId: 't7' }),
      change('d', 'cli.py', 'pending', { taskId: 't9' }),
    ];
    expect(reworkClosure([chain[0]], chain).map((t) => t.id)).toEqual(['t5', 't6', 't7']);
    expect(reworkClosure([chain[3]], chain).map((t) => t.id)).toEqual(['t9']);
  });
});
