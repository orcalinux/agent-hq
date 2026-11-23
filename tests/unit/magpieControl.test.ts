import { describe, expect, it } from 'vitest';
import { groupCommands, parseQuotas } from '../../server/magpieControl';

describe('Magpie quotas', () => {
  it('keeps percent left and reset times, and drops account names and emails', () => {
    const quotas = parseQuotas({
      data: [
        { provider: 'claude', name: 'Claude Code', kind: 'subscription', plan: 'pro', user: 'someone@example.com', windows: [{ name: '5 hours', used: 14.2, remaining: 85.8, resetsAt: '2026-11-21T22:30:00-05:00' }, { name: '7 days', used: 64 }] },
        { provider: 'codex', windows: [{ name: '5 hours', remaining: 120 }, { name: 'broken' }] },
        { nothing: true },
      ],
    });
    expect(quotas).toEqual([
      { provider: 'claude', name: 'Claude Code', kind: 'subscription', plan: 'pro', windows: [{ name: '5 hours', remaining: 86, resetsAt: '2026-11-21T22:30:00-05:00' }, { name: '7 days', remaining: 36 }] },
      { provider: 'codex', name: 'codex', kind: 'account', windows: [{ name: '5 hours', remaining: 100 }] },
    ]);
    expect(JSON.stringify(quotas)).not.toContain('@');
    expect(parseQuotas(null)).toEqual([]);
  });

  it('keeps when Magpie last read a subscription, and a real 0% left', () => {
    const [codex] = parseQuotas({ data: [{ provider: 'codex', readAt: '2026-11-23T06:06:55-05:00', windows: [{ name: '5 hours', used: 100, remaining: 0 }] }] });
    expect(codex.readAt).toBe('2026-11-23T06:06:55-05:00');
    expect(codex.windows).toEqual([{ name: '5 hours', remaining: 0 }]);
  });
});

describe('Magpie group commands', () => {
  it('creates the group with its routing, then notes it and sets weights', () => {
    const cmds = groupCommands({ id: 'agenthq-complex', models: ['claude/claude-opus-5-5', 'codex/gpt-6.2-sol'], routing: 'weight', weights: { 'claude/claude-opus-5-5': 90, 'codex/gpt-6.2-sol': 5000 } });
    expect(cmds[0]).toEqual(['group', 'add', 'agenthq-complex', 'models=claude/claude-opus-5-5,codex/gpt-6.2-sol', 'routing=weight', 'stays=session']);
    expect(cmds[1]).toContain('weight=claude/claude-opus-5-5=90,codex/gpt-6.2-sol=1000');
    expect(groupCommands({ id: 'agenthq-simple', models: ['claude/claude-haiku-5-5'], routing: 'usage' })[1].some((a) => a.startsWith('weight='))).toBe(false);
  });

  it('only touches Agent HQ groups and refuses odd model ids or routings', () => {
    expect(() => groupCommands({ id: 'smart-coding', models: ['a/b'], routing: 'usage' })).toThrow(/Not an Agent HQ group/);
    expect(() => groupCommands({ id: 'agenthq-simple', models: ['a/b'], routing: 'smart' as never })).toThrow(/Unknown routing/);
    expect(() => groupCommands({ id: 'agenthq-simple', models: ['a b; rm -rf', '$(x)'], routing: 'usage' })).toThrow(/No Magpie models/);
  });
});
