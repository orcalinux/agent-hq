import { describe, expect, it } from 'vitest';
import { missingImplementation, parseProjectRequest, readProjectRequest } from '../../src/engine/projectTools';

describe('host project reads', () => {
  it('rejects malformed requests and traversal instead of treating them as final answers', () => {
    for (const text of [
      '```project-call\n{}',
      '```project-call\nnull\n```',
      '```project-call\n{"name":"read_files","paths":["../outside"]}\n```',
      '```project-call\n{"name":"read_files","paths":["/etc/passwd"]}\n```',
      '```project-call\n{"name":"read_files","paths":["src/main.ts"],"lineCount":100000}\n```',
      '```project-call\n{"name":"execute"}\n```',
    ]) expect(parseProjectRequest(text)).toHaveProperty('error');
    expect(parseProjectRequest('Normal final answer')).toBeNull();
  });

  it('lists files by substring and reads only known project paths with line boundaries', async () => {
    const request = parseProjectRequest('```project-call\n{"name":"read_files","paths":["src/main.ts","outside"],"startLine":2,"lineCount":2}\n```');
    if (!request || !('request' in request)) throw new Error('Expected a valid request');
    const reads: string[] = [];
    const reply = await readProjectRequest(request.request, ['src/main.ts'], async (path) => {
      reads.push(path);
      return 'first\nsecond\nthird\nfourth';
    });
    expect(reads).toEqual(['src/main.ts']);
    expect(reply).toContain('2: second\n3: third');
    expect(reply).toContain('next startLine=4');
    expect(reply).toContain('outside: unavailable');
    expect(await readProjectRequest({ name: 'list_files', query: 'MAIN' }, ['src/main.ts', 'other.py'], async () => '')).toContain('src/main.ts');
  });

  it('bounds oversized lines and lets the caller supply current dependency edits', async () => {
    const reply = await readProjectRequest({ name: 'read_files', paths: ['a', 'b'], startLine: 1, lineCount: 800 }, ['a', 'b'], async () => 'x'.repeat(50_000));
    expect(reply).toContain('response clipped');
    expect(reply).toContain('b: not read');
    expect(reply.length).toBeLessThan(41_000);
    const current = await readProjectRequest({ name: 'read_files', paths: ['a'], startLine: 1, lineCount: 10 }, ['a'], async () => 'pending dependency change');
    expect(current).toContain('pending dependency change');
  });

  it('does not count an empty implementation answer as a successful deliverable', () => {
    expect(missingImplementation('implementation', 0, 0)).toBe(true);
    expect(missingImplementation('implementation', 1, 0)).toBe(false);
    expect(missingImplementation('architecture', 0, 0)).toBe(false);
    expect(missingImplementation('implementation', 0, 1)).toBe(false);
  });
});
