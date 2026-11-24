import type { ChatUsage } from '../types/mission';

export function usageCounts(usage?: ChatUsage): { prompt: number; completion: number; total: number } {
  const prompt = (usage?.inputTokens ?? 0) + (usage?.cacheReadTokens ?? 0) + (usage?.cacheWriteTokens ?? 0);
  const completion = usage?.outputTokens ?? 0;
  return { prompt, completion, total: Math.max(usage?.totalTokens ?? 0, prompt + completion) };
}
