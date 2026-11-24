import { describe, expect, it } from 'vitest';
import { usageCounts } from '../../src/utils/usage';

describe('usage totals', () => {
  it('includes cache reads and writes once as prompt tokens', () => {
    expect(usageCounts({ inputTokens: 100, outputTokens: 5, cacheReadTokens: 1900, cacheWriteTokens: 50, cacheWrite1hTokens: 20, totalTokens: 2055 })).toEqual({ prompt: 2050, completion: 5, total: 2055 });
  });
  it('keeps reported-only usage and plain API input totals', () => {
    expect(usageCounts({ totalTokens: 42 })).toEqual({ prompt: 0, completion: 0, total: 42 });
    expect(usageCounts({ inputTokens: 20, outputTokens: 2 })).toEqual({ prompt: 20, completion: 2, total: 22 });
    expect(usageCounts()).toEqual({ prompt: 0, completion: 0, total: 0 });
  });
});
