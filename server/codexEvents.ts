import type { ChatUsage } from './providers';

const tokens = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;

export function parseCodexEvents(stdout: string): { text: string; usage?: ChatUsage; error?: string } {
  let text = '';
  let error: string | undefined;
  let reported = false;
  const usage: Required<Pick<ChatUsage, 'inputTokens' | 'outputTokens' | 'totalTokens' | 'cacheReadTokens'>> = {
    inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheReadTokens: 0,
  };
  for (const line of stdout.split('\n')) {
    let event: Record<string, unknown>;
    try { event = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
    if (!event || typeof event !== 'object') continue;
    const item = event.item as { type?: string; text?: string } | undefined;
    if (event.type === 'item.completed' && item?.type === 'agent_message' && typeof item.text === 'string') text = item.text;
    if (event.type === 'turn.failed' || event.type === 'error') {
      const detail = event.error as { message?: string } | undefined;
      if (typeof detail?.message === 'string') error = detail.message;
      else if (typeof event.message === 'string') error = event.message;
      else error = 'Codex turn failed.';
    }
    if (event.type !== 'turn.completed' || !event.usage || typeof event.usage !== 'object') continue;
    const counts = event.usage as Record<string, unknown>;
    if (typeof counts.input_tokens !== 'number' || typeof counts.output_tokens !== 'number') continue;
    reported = true;
    const input = tokens(counts.input_tokens);
    const cached = Math.min(input, tokens(counts.cached_input_tokens));
    const output = tokens(counts.output_tokens);
    usage.inputTokens += input - cached;
    usage.cacheReadTokens += cached;
    usage.outputTokens += output;
    usage.totalTokens += input + output;
  }
  return { text, ...(reported ? { usage } : {}), ...(error ? { error } : {}) };
}
