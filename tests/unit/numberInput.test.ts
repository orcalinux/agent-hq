import { describe, expect, it } from 'vitest';
import { sanitizeNumber, stepValue } from '@/components/ui/NumberInput';

describe('NumberInput helpers', () => {
  it('steps without floating point drift', () => {
    expect(stepValue('0.1', 1, 0.5)).toBe('0.6');
    expect(stepValue('2.5', 1, 0.5)).toBe('3');
    expect(stepValue('0.3', 1, 0.1)).toBe('0.4');
  });
  it('starts from zero when empty or invalid and never goes below the minimum', () => {
    expect(stepValue('', 1, 5)).toBe('5');
    expect(stepValue('', -1, 5)).toBe('0');
    expect(stepValue('2', -1, 5)).toBe('0');
    expect(stepValue('.', 1, 5)).toBe('5');
  });
  it('keeps only digits and one decimal point', () => {
    expect(sanitizeNumber('1a2.5.6')).toBe('12.56');
    expect(sanitizeNumber('-3')).toBe('3');
    expect(sanitizeNumber('')).toBe('');
  });
});
