import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { claudeAccountPricing, readClaudeCatalog } from '../../server/claudeCatalog';
import { claudeCliUsage, claudeModelChoices } from '../../server/cliModelIdentity';
import { calculateTokenCostUSD, type ModelPricing } from '../../src/types/model';

const costs = {
  'claude-opus-5-5': {
    inputTokens: 4, outputTokens: 20, promptCacheWriteTokens: 5, promptCacheWrite1hTokens: 8, promptCacheReadTokens: 0.2,
    webSearchRequests: 0.01, fast: { inputTokens: 8, outputTokens: 40 },
  },
  'claude-haiku-5-5': {
    inputTokens: 0.1, outputTokens: 0.5, promptCacheWriteTokens: 0.125, promptCacheReadTokens: 0.01,
    longPrompt: { abovePromptTokens: 100000, inputTokens: 0.5, outputTokens: 2.5, promptCacheWriteTokens: 0.625, promptCacheReadTokens: 0.05 },
  },
  'claude-free-5-5': { inputTokens: 0, outputTokens: 0 },
  'claude-broken-5-5': { inputTokens: 'four', outputTokens: 20 },
  'claude-negative-5-5': { inputTokens: -1, outputTokens: 20 },
  'claude-nan-5-5': { inputTokens: Number.NaN, outputTokens: 20 },
  'claude-badcache-5-5': { inputTokens: 3, outputTokens: 15, promptCacheReadTokens: -2, longPrompt: { abovePromptTokens: 'many', inputTokens: 6, outputTokens: 30 } },
};

describe('Claude account rate card', () => {
  it('reads USD-per-million rates as is, with cache rates and the long-prompt tier', () => {
    expect(claudeAccountPricing(costs, 'claude-opus-5-5')).toEqual({
      source: 'account', inputPerM: 4, outputPerM: 20, cacheReadPerM: 0.2, cacheWritePerM: 5, cacheWrite1hPerM: 8,
    });
    expect(claudeAccountPricing(costs, 'claude-haiku-5-5')?.longPrompt).toEqual({
      abovePromptTokens: 100000, inputPerM: 0.5, outputPerM: 2.5, cacheReadPerM: 0.05, cacheWritePerM: 0.625,
    });
  });

  it('rejects missing, zero, negative, NaN and non-numeric rates instead of guessing', () => {
    for (const id of ['claude-free-5-5', 'claude-broken-5-5', 'claude-negative-5-5', 'claude-nan-5-5', 'claude-unknown-5-5', 'opus']) {
      expect(claudeAccountPricing(costs, id)).toBeUndefined();
    }
    expect(claudeAccountPricing(costs, 'claude-badcache-5-5')).toEqual({ source: 'account', inputPerM: 3, outputPerM: 15 });
    expect(claudeAccountPricing(null, 'claude-opus-5-5')).toBeUndefined();
    expect(claudeAccountPricing([], 'claude-opus-5-5')).toBeUndefined();
  });

  it('prices only the exact catalog IDs and carries rates to known legacy references', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hq-pricing-'));
    try {
      fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({
        additionalModelOptionsCache: [{ value: 'claude-opus-5-5', label: 'Opus 5.5' }, { value: 'claude-sonnet-5-5', label: 'Sonnet 5.5' }],
        additionalModelCostsCache: costs,
      }));
      const catalog = readClaudeCatalog(dir);
      expect(catalog.models.find((m) => m.id === 'claude-opus-5-5')?.pricing?.inputPerM).toBe(4);
      expect(catalog.models.find((m) => m.id === 'claude-sonnet-5-5')?.pricing).toBeUndefined();
      const choices = claudeModelChoices({
        providerId: 'anthropic', method: 'cli', connectedAt: '',
        cliModelObservation: { cwd: '/p', models: { default: ['claude-opus-5-5'] } },
      }, '/p', catalog);
      expect(choices.find((m) => m.id === 'default')?.pricing?.outputPerM).toBe(20);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Claude CLI usage', () => {
  it('keeps cache reads and 5-minute/1-hour cache writes outside input tokens', () => {
    expect(claudeCliUsage({
      input_tokens: 10, output_tokens: 200, cache_read_input_tokens: 30000, cache_creation_input_tokens: 5000,
      cache_creation: { ephemeral_1h_input_tokens: 1000, ephemeral_5m_input_tokens: 4000 },
    })).toEqual({ inputTokens: 10, outputTokens: 200, totalTokens: 35210, cacheReadTokens: 30000, cacheWriteTokens: 5000, cacheWrite1hTokens: 1000 });
    expect(claudeCliUsage({ input_tokens: 3, output_tokens: 4 })).toEqual({ inputTokens: 3, outputTokens: 4, totalTokens: 7 });
    expect(claudeCliUsage({ input_tokens: -5, output_tokens: Number.NaN })).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  });
});

describe('token cost', () => {
  const opus: ModelPricing = { source: 'account', inputPerM: 4, outputPerM: 20, cacheReadPerM: 0.2, cacheWritePerM: 5, cacheWrite1hPerM: 8 };
  const haiku: ModelPricing = {
    source: 'account', inputPerM: 0.1, outputPerM: 0.5, cacheReadPerM: 0.01, cacheWritePerM: 0.125,
    longPrompt: { abovePromptTokens: 100000, inputPerM: 0.5, outputPerM: 2.5, cacheReadPerM: 0.05, cacheWritePerM: 0.625 },
  };

  it('keeps the plain input/output calculation for prices without cache rates', () => {
    expect(calculateTokenCostUSD({ source: 'provider', inputPerM: 3, outputPerM: 15 }, 1_000_000, 1_000_000)).toBe(18);
    expect(calculateTokenCostUSD(undefined, 10, 10)).toBeNull();
  });

  it('prices cache reads and 5-minute and 1-hour writes at their own rates', () => {
    expect(calculateTokenCostUSD(opus, 1_000_000, 1_000_000, { cacheReadTokens: 1_000_000, cacheWriteTokens: 2_000_000, cacheWrite1hTokens: 1_000_000 }))
      .toBe(4 + 20 + 0.2 + 5 + 8);
  });

  it('bills the whole call at the long-prompt tier once the full prompt crosses it', () => {
    expect(calculateTokenCostUSD(haiku, 100_000, 1_000_000)).toBe(0.01 + 0.5);
    expect(calculateTokenCostUSD(haiku, 1_000, 1_000_000, { cacheReadTokens: 100_000 })).toBeCloseTo(0.0005 + 2.5 + 0.005, 6);
  });
});
