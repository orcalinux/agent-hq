import { describe, expect, it } from 'vitest';
import { cloneFolderName } from '../../src/utils/cloneInput';

describe('cloneFolderName', () => {
  it('derives the folder from common address forms', () => {
    expect(cloneFolderName('orcalinux/agent-hq')).toBe('agent-hq');
    expect(cloneFolderName('https://github.com/a/b.git')).toBe('b');
    expect(cloneFolderName('git@github.com:a/b.git')).toBe('b');
    expect(cloneFolderName(' https://github.com/a/b/ ')).toBe('b');
  });
  it('returns nothing for empty or unsafe names', () => {
    expect(cloneFolderName('')).toBe('');
    expect(cloneFolderName('https://github.com/a/..')).toBe('');
    expect(cloneFolderName('https://github.com/a/-x')).toBe('');
  });
});
