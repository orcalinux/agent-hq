import { describe, expect, it } from 'vitest';
import { parseCodexEvents } from '../../server/codexEvents';

describe('Codex event accounting', () => {
  it('keeps the final answer and counts cache reads once', () => {
    const result = parseCodexEvents([
      '{"type":"thread.started","thread_id":"a"}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"Checking"}}',
      '{"type":"item.completed","item":{"type":"reasoning","text":"private reasoning"}}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"READY"}}',
      '{"type":"turn.completed","usage":{"input_tokens":93863,"cached_input_tokens":3968,"output_tokens":5}}',
    ].join('\n'));
    expect(result).toEqual({ text: 'READY', usage: { inputTokens: 89895, cacheReadTokens: 3968, outputTokens: 5, totalTokens: 93868 } });
  });

  it('sums completed turns, accepts zero usage and never invents it from logs', () => {
    const event = '{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":4,"output_tokens":2}}';
    expect(parseCodexEvents(`${event}\n${event}`).usage).toEqual({ inputTokens: 12, cacheReadTokens: 8, outputTokens: 4, totalTokens: 24 });
    expect(parseCodexEvents('{"type":"turn.completed","usage":{"input_tokens":0,"output_tokens":0}}').usage?.totalTokens).toBe(0);
    expect(parseCodexEvents('tokens used 10').usage).toBeUndefined();
    expect(parseCodexEvents('null\n[]\nno json').text).toBe('');
  });

  it('surfaces a terminal error while ignoring nonfatal item diagnostics', () => {
    expect(parseCodexEvents('{"type":"item.completed","item":{"type":"error","message":"metadata warning"}}').error).toBeUndefined();
    expect(parseCodexEvents('{"type":"turn.failed","error":{"message":"quota exceeded"}}').error).toBe('quota exceeded');
  });
});
