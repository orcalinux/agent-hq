import { describe, expect, it } from 'vitest';
import { adoptMentorRevision, extractFileBlocks, extractJson, parseQaVerdict, topoOrder } from '../../src/engine/orchestratorParsing';

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
    expect(extractFileBlocks(text)).toEqual([{ path: 'src/a.ts', content: 'export const a = 1;\n' }]);
  });

  it('keeps the final newline the file had before the closing fence', () => {
    expect(extractFileBlocks('```ts path=a.ts\nline 1\nline 2\n```')[0].content).toBe('line 1\nline 2\n');
    expect(extractFileBlocks('```md path=empty.md\n```')[0].content).toBe('');
  });

  it('normalizes QA verdicts and unknown task ids', () => {
    const verdict = parseQaVerdict('{"verdict":"Reject","summary":"s","issues":[{"taskId":"t9","problem":"p"}]}', ['t1']);
    expect(verdict).toEqual({ verdict: 'reject', summary: 's', issues: [{ taskId: '', problem: 'p' }] });
  });

  it('resolves requirement references like #22 to the owning task when tasks are provided', () => {
    const tasks = [
      { id: 't1', title: 'Percent split', description: 'Handle #21 percent mode' },
      { id: 't2', title: 'Simplify DP', description: 'Fix issue #22 complexity for 16 members' },
    ];
    const verdict = parseQaVerdict(
      '{"verdict":"reject","summary":"missed","issues":[{"taskId":"#22","problem":"slow DP","path":"settle.py","evidence":"for subset in subsets:"}]}',
      ['t1', 't2'],
      tasks,
    );
    expect(verdict.issues[0].taskId).toBe('t2');
    const unmatched = parseQaVerdict(
      '{"verdict":"reject","summary":"missed","issues":[{"taskId":"#2","problem":"wrong id"}]}',
      ['t1', 't2'],
      tasks,
    );
    expect(unmatched.issues[0].taskId).toBe('');
  });

  it('keeps the junior files when a mentor revision drops them', () => {
    const junior = '```py path=a.py\nx = 1\n```';
    expect(adoptMentorRevision(junior, 'Looks fine but unverified.')).toBe(junior);
    expect(adoptMentorRevision(junior, undefined)).toBe(junior);
    const fixed = '```py path=a.py\nx = 2\n```';
    expect(adoptMentorRevision(junior, fixed)).toBe(fixed);
    expect(adoptMentorRevision('no files here', 'prose')).toBe('prose');
  });
});
