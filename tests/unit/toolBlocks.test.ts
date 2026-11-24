import { describe, expect, it } from 'vitest';
import { hostToolBlocks } from '../../src/engine/toolBlocks';

describe('host tool blocks', () => {
  it('does not dispatch examples embedded inside proposed files or longer fences', () => {
    expect(hostToolBlocks('```ts path=example.ts\nconst example = `\n```computer-call\n{"name":"click"}\n```\n`;\n```', 'computer-call').blocks).toEqual([]);
    expect(hostToolBlocks('````markdown path=guide.md\n```project-call\n{"name":"list_files"}\n```\n````', 'project-call').blocks).toEqual([]);
  });
  it('reports unclosed requests and preserves distinct top-level requests', () => {
    expect(hostToolBlocks('```project-call\n{}', 'project-call').unclosed).toBe(true);
    expect(hostToolBlocks('Reading first.\n```project-call\n{}\n```\n```project-call\n{"x":1}\n```', 'project-call')).toEqual({ blocks: ['{}', '{"x":1}'], unclosed: false });
  });
});
