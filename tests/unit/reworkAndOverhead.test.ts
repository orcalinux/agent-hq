import { describe, expect, it } from 'vitest';
import { runCreatedTests, runModifiedTests, selectQaReworkTargets } from '../../src/engine/approval';
import { compactFileOutputs } from '../../src/engine/orchestratorParsing';
import { PROJECT_TOOL_INSTRUCTIONS, isAlreadySatisfiedRework, missingImplementation } from '../../src/engine/projectTools';

describe('Phase 1: QA rework targeting, read-only instructions, and context compaction', () => {
  it('selects only directly flagged QA tasks instead of pulling downstream dependents into rework', () => {
    const tasks = [
      { id: 't1', dependsOn: [] },
      { id: 't2', dependsOn: ['t1'] },
      { id: 't3', dependsOn: ['t2'] },
    ];
    expect(selectQaReworkTargets(['t1'], tasks).map((t) => t.id)).toEqual(['t1']);
    expect(selectQaReworkTargets([], tasks).map((t) => t.id)).toEqual(['t1', 't2', 't3']);
    expect(selectQaReworkTargets(['unknown-id'], tasks).map((t) => t.id)).toEqual(['t1', 't2', 't3']);
  });

  it('allows no-op ALREADY_SATISFIED rework only when prior changes exist for the task', () => {
    expect(isAlreadySatisfiedRework('ALREADY_SATISFIED: t2 already handles empty groups.', true)).toBe(true);
    expect(isAlreadySatisfiedRework('  already_satisfied\nNo edits required.', true)).toBe(true);
    expect(isAlreadySatisfiedRework('ALREADY_SATISFIED: nothing to do', false)).toBe(false);
    expect(isAlreadySatisfiedRework('The workspace is read-only so I cannot edit files.', true)).toBe(false);
    expect(missingImplementation('implementation', 0, 0)).toBe(true);
  });

  it('tells workers that Agent HQ writes path= blocks even in read-only CLI sandboxes', () => {
    expect(PROJECT_TOOL_INSTRUCTIONS).toContain('read-only');
    expect(PROJECT_TOOL_INSTRUCTIONS).toContain('ALREADY_SATISFIED:');
  });

  it('compacts fenced path= blocks in dependency/QA summaries while preserving prose and non-path fences', () => {
    const output = `<think>hidden chain of thought</think>Summary: added parser and tests.
\`\`\`ts path=src/parser.ts
export function a() {
  return 1;
}
\`\`\`
Architecture note:
\`\`\`json
{"ok": true}
\`\`\`
Verified edge cases pass.`;
    const compacted = compactFileOutputs(output, 4_000);
    expect(compacted).not.toContain('hidden chain of thought');
    expect(compacted).not.toContain('export function a()');
    expect(compacted).toContain('[wrote path=src/parser.ts');
    expect(compacted).toContain('{"ok": true}');
    expect(compacted).toContain('Verified edge cases pass.');
  });

  it('tracks runCreatedTests separately from pre-existing test files modified during a run', () => {
    const changes = [
      { id: 'c1', path: 'tests/new.test.ts', content: '...', taskId: 't1', agentId: 'a1', status: 'applied' as const, previousContent: null },
      { id: 'c2', path: 'tests/public.test.ts', content: 'updated', taskId: 't2', agentId: 'a2', status: 'applied' as const, previousContent: 'original' },
      { id: 'c3', path: 'tests/new.test.ts', content: 'v2', taskId: 't1', agentId: 'a1', status: 'applied' as const, previousContent: '...' },
      { id: 'c4', path: 'src/exporter.ts', content: 'code', taskId: 't2', agentId: 'a2', status: 'applied' as const, previousContent: 'old' },
    ];
    expect(runCreatedTests(changes)).toEqual(['tests/new.test.ts']);
    expect(runModifiedTests(changes)).toEqual(['tests/public.test.ts']);
  });
});
