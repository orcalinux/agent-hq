import { describe, expect, it } from 'vitest';
import { extractFileBlocks, extractJson, parseQaVerdict, topoOrder } from '../../src/engine/orchestratorParsing';

describe('orchestrator parsing', () => {
  it('extracts JSON from fenced, bare and reasoning-prefixed responses', () => {
    expect(extractJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(extractJson('<think>{"no": true}</think>Here: {"b": "}"} trailing')).toEqual({ b: '}' });
    expect(() => extractJson('no json here')).toThrow();
  });

  it('orders by dependencies and rejects cycles', () => {
    const order = topoOrder([
      { id: 'b', dependsOn: ['a'] },
      { id: 'a', dependsOn: [] },
    ]).map((t) => t.id);
    expect(order).toEqual(['a', 'b']);
    expect(() => topoOrder([{ id: 'a', dependsOn: ['b'] }, { id: 'b', dependsOn: ['a'] }])).toThrow(/cycle/);
  });

  it('extracts file blocks and drops unsafe paths', () => {
    const text = '```ts path=src/a.ts\nexport const a = 1;\n```\n```ts path=../evil.ts\nx\n```\n```sh path=/etc/passwd\nx\n```';
    expect(extractFileBlocks(text)).toEqual([{ path: 'src/a.ts', content: 'export const a = 1;' }]);
  });

  it('normalizes QA verdicts and unknown task ids', () => {
    const verdict = parseQaVerdict('{"verdict":"Reject","summary":"s","issues":[{"taskId":"t9","problem":"p"}]}', ['t1']);
    expect(verdict).toEqual({ verdict: 'reject', summary: 's', issues: [{ taskId: '', problem: 'p' }] });
  });
});
