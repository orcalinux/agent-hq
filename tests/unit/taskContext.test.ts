import { describe, expect, it } from 'vitest';
import { selectRelevantFiles } from '../../src/engine/taskContext';

const files = ['src/App.tsx', 'src/api/client.ts', 'server/client.ts', 'README.md', 'src/main.tsx'];

describe('selectRelevantFiles', () => {
  it('finds files by path and unique file name, in order of mention', () => {
    expect(selectRelevantFiles('Update README.md, then wire src/api/client.ts into App.tsx', files)).toEqual([
      'README.md',
      'src/api/client.ts',
      'src/App.tsx',
    ]);
  });

  it('ignores ambiguous file names and partial matches', () => {
    expect(selectRelevantFiles('Refactor client.ts and domain.tsx', files)).toEqual([]);
  });

  it('caps the number of files', () => {
    expect(selectRelevantFiles(files.join(' '), files, 2)).toHaveLength(2);
  });
});
