import { describe, expect, it } from 'vitest';
import { parseComplexity, resolveTiers, routeTaskModel, routingFor, scopeModels, suggestTiers, taskComplexity, tierOf, versionOf } from '../../src/engine/modelRouting';
import { diffModels, isCheckDue, snapshotModels } from '../../src/engine/modelWatch';
import { parsePlan } from '../../src/engine/orchestratorParsing';
import { DEFAULT_AGENTS } from '../../src/store/defaultState';
import type { ModelInfo, ProviderState } from '../../src/types';

const claude = (id: string, name: string) => ({ ref: `anthropic:cli:${id}`, name });
const CLAUDE = [
  claude('claude-fable-5-2', 'Claude Fable 5.2'),
  claude('claude-opus-5-5', 'Claude Opus 5.5'),
  claude('claude-sonnet-5-5', 'Claude Sonnet 5.5'),
  claude('claude-haiku-5-5', 'Claude Haiku 5.5'),
  claude('claude-haiku-4-5-20251001', 'Claude Haiku 4.5'),
  claude('claude-sonnet-5', 'Claude Sonnet 5'),
  claude('claude-opus-4-8', 'Claude Opus 4.8'),
];

function provider(id: ProviderState['id'], name: string, models: Array<{ ref: string; name: string }>, connected = true, aliases: ModelInfo[] = []): ProviderState {
  return {
    id, name, methods: ['cli'], envVars: [], envKeyPresent: false, docsUrl: '', notes: '',
    connection: connected ? { method: 'cli', connectedAt: '' } : null,
    models: [...models.map((m) => ({ ...m, providerId: id, id: m.ref, via: 'cli' as const, capabilities: ['chat'], selectable: true })), ...aliases],
  };
}

describe('model tiers', () => {
  it('sorts families into simple, standard and complex for any provider', () => {
    expect(tierOf(claude('claude-haiku-5-5', 'Claude Haiku 5.5'))).toBe('simple');
    expect(tierOf(claude('claude-sonnet-5-5', 'Claude Sonnet 5.5'))).toBe('standard');
    expect(tierOf(claude('claude-opus-5-5', 'Claude Opus 5.5'))).toBe('complex');
    expect(tierOf({ ref: 'openai:gpt-5-mini', name: 'GPT-5 mini' })).toBe('simple');
    expect(tierOf({ ref: 'google:gemini-2.5-pro', name: 'Gemini 2.5 Pro' })).toBe('complex');
    expect(tierOf({ ref: 'google:gemini-2.5-flash', name: 'Gemini 2.5 Flash' })).toBe('simple');
  });

  it('reads versions and ignores release dates', () => {
    expect(versionOf('anthropic:cli:claude-opus-5-5')).toEqual([5, 5]);
    expect(versionOf('anthropic:cli:claude-haiku-4-5-20251001')).toEqual([4, 5]);
  });

  it('suggests Haiku, Sonnet and Opus, newest version first, whatever the list order', () => {
    expect(suggestTiers(CLAUDE)).toEqual({
      simple: 'anthropic:cli:claude-haiku-5-5',
      standard: 'anthropic:cli:claude-sonnet-5-5',
      complex: 'anthropic:cli:claude-opus-5-5',
    });
    expect(suggestTiers([...CLAUDE].reverse()).complex).toBe('anthropic:cli:claude-opus-5-5');
  });

  it('moves to a model released later on its own', () => {
    const later = [claude('claude-opus-6', 'Claude Opus 6'), claude('claude-haiku-6', 'Claude Haiku 6'), ...CLAUDE];
    expect(suggestTiers(later)).toMatchObject({ simple: 'anthropic:cli:claude-haiku-6', complex: 'anthropic:cli:claude-opus-6' });
  });

  it('fills a missing tier from its neighbours', () => {
    expect(suggestTiers([claude('claude-sonnet-5-5', 'Claude Sonnet 5.5')]).complex).toBe('anthropic:cli:claude-sonnet-5-5');
  });

  it('keeps a pinned model only while it is offered', () => {
    expect(resolveTiers(CLAUDE, { complex: 'anthropic:cli:claude-opus-4-8' }).complex).toBe('anthropic:cli:claude-opus-4-8');
    expect(resolveTiers(CLAUDE, { complex: 'anthropic:cli:gone' }).complex).toBe('anthropic:cli:claude-opus-5-5');
  });
});

describe('one subscription', () => {
  const providers = [
    provider('anthropic', 'Anthropic', CLAUDE, true, [{ ref: 'anthropic:cli:default', providerId: 'anthropic', id: 'cli:default', name: 'Claude Opus 5.5', via: 'cli', capabilities: ['chat'], selectable: false, canonicalRef: 'anthropic:cli:claude-opus-5-5' }]),
    provider('openai', 'OpenAI', [{ ref: 'openai:cli:gpt-5', name: 'GPT-5' }]),
    provider('google', 'Google', [{ ref: 'google:cli:gemini', name: 'Gemini' }], false),
  ];

  it("limits models to Sovereign's provider, including through the CLI default alias", () => {
    const { models, tiers } = routingFor(providers, { scope: 'sovereign', overrides: {}, sovereignModel: 'anthropic:cli:default' });
    expect(models.every((m) => m.ref.startsWith('anthropic:'))).toBe(true);
    expect(tiers.complex).toBe('anthropic:cli:claude-opus-5-5');
  });

  it('offers every connected provider with scope any, and skips out-of-credit ones', () => {
    expect(routingFor(providers, { scope: 'any', overrides: {}, sovereignModel: 'anthropic:cli:default' }).models.map((m) => m.ref)).toContain('openai:cli:gpt-5');
    expect(routingFor(providers, { scope: 'any', overrides: {}, sovereignModel: '', skip: (id) => id === 'anthropic' }).models.map((m) => m.ref)).toEqual(['openai:cli:gpt-5']);
  });

  it('falls back to all models when Sovereign has none', () => {
    expect(scopeModels(CLAUDE, 'sovereign', '')).toHaveLength(CLAUDE.length);
  });
});

describe('routing a task', () => {
  const tiers = { simple: 's', standard: 'm', complex: 'c' };
  it('uses the model for the complexity, guessing it when Sovereign did not say', () => {
    expect(routeTaskModel({ complexity: 'simple' }, tiers, new Set(['s', 'm', 'c']))).toBe('s');
    expect(routeTaskModel({ stage: 'architecture' }, tiers, new Set())).toBe('c');
    expect(routeTaskModel({}, tiers, new Set(), true)).toBe('s');
    expect(taskComplexity({ priority: 'critical' })).toBe('complex');
  });

  it('keeps a deliberate model in scope and replaces one outside it', () => {
    expect(routeTaskModel({ model: 'c', complexity: 'simple' }, tiers, new Set(['s', 'c']))).toBe('c');
    expect(routeTaskModel({ model: 'openai:x', complexity: 'standard' }, tiers, new Set(['s', 'm']))).toBe('m');
  });

  it('reads complexity from the plan', () => {
    expect(parseComplexity('Hard')).toBe('complex');
    const plan = parsePlan(JSON.stringify({ summary: 's', tasks: [{ id: 't1', title: 'Rename', agentId: 'agent-frontend', complexity: 'simple' }, { id: 't2', title: 'X', agentId: 'agent-backend', complexity: 'nonsense' }] }), DEFAULT_AGENTS);
    expect(plan.tasks[0].complexity).toBe('simple');
    expect(plan.tasks[1].complexity).toBeUndefined();
  });
});

describe('model update check', () => {
  const before = [provider('anthropic', 'Anthropic', CLAUDE)];
  it('takes a baseline the first time, then reports added and removed models', () => {
    expect(diffModels({}, snapshotModels(before), before)).toEqual([]);
    const after = [provider('anthropic', 'Anthropic', [claude('claude-opus-6', 'Claude Opus 6'), ...CLAUDE.slice(1)])];
    const [change] = diffModels(snapshotModels(before), snapshotModels(after), after, 1);
    expect(change.added.map((m) => m.name)).toEqual(['Claude Opus 6']);
    expect(change.removed.map((m) => m.name)).toEqual(['Claude Fable 5.2']);
  });

  it('ignores aliases and disconnected providers', () => {
    const snap = snapshotModels([provider('google', 'Google', [{ ref: 'g:x', name: 'x' }], false)]);
    expect(snap).toEqual({});
  });

  it('runs when the interval has passed, never when off', () => {
    expect(isCheckDue(null, 6, 0)).toBe(true);
    expect(isCheckDue(0, 6, 5 * 3_600_000)).toBe(false);
    expect(isCheckDue(0, 6, 6 * 3_600_000)).toBe(true);
    expect(isCheckDue(null, 0)).toBe(false);
  });
});
