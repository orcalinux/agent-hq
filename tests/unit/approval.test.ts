import { describe, expect, it } from 'vitest';
import { APPROVAL_MODES, approvalModeInfo, autoAppliesChanges, autoStartsRuns, canRevert, selectAutoApply } from '../../src/engine/approval';
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
  it('applies the latest pending proposal per path and supersedes earlier ones', () => {
    const { apply, superseded } = selectAutoApply([
      change('a1', 'src/a.ts'),
      change('b1', 'src/b.ts'),
      change('a2', 'src/a.ts'),
      change('c1', 'src/c.ts', 'applied'),
      change('d1', 'src/d.ts', 'discarded'),
    ]);
    expect(apply.map((c) => c.id)).toEqual(['b1', 'a2']);
    expect(superseded.map((c) => c.id)).toEqual(['a1']);
  });

  it('returns nothing when no change is pending', () => {
    expect(selectAutoApply([change('x', 'x.ts', 'applied')])).toEqual({ apply: [], superseded: [] });
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
