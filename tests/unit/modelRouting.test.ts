import { describe, expect, it } from 'vitest';
import { assignAgentModels, assignPlanModels, chooseTiers, hireModel, isManagedGroup, magpieGroupsFor, quotaKeyOf, fallbackForTier, learnedBonus, parseComplexity, profileOf, rankModels, resolveRouting, resolveTiers, routeTaskModel, routingFor, scopeModels, suggestTiers, taskComplexity, tierOf, versionOf } from '../../src/engine/modelRouting';
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

describe('new specialist model policy', () => {
  const allowed = new Set(['fast', 'strong']);

  it('keeps forced pins when the planner hires a specialist on a different model', () => {
    expect(hireModel({ role: 'backend', model: 'strong' }, allowed, { force: true, pinned: { standard: 'fast' } })).toBe('fast');
    expect(hireModel({ role: 'qa', model: 'strong' }, allowed, { modes: { complex: 'locked' }, pinned: { complex: 'fast' } })).toBe('fast');
    expect(hireModel({ role: 'backend', junior: true, model: 'strong' }, allowed, { force: true, pinned: { simple: 'fast' } })).toBe('fast');
  });

  it('uses role defaults when force has no available pin', () => {
    expect(hireModel({ model: 'strong' }, allowed, { force: true })).toBeUndefined();
    expect(hireModel({ model: 'strong' }, allowed, { force: true, pinned: { standard: 'unavailable' } })).toBeUndefined();
  });

  it('allows dynamic choices and replaces choices outside the available scope', () => {
    expect(hireModel({ model: 'strong' }, allowed, {}, { standard: 'fast' })).toBe('strong');
    expect(hireModel({ model: 'unavailable' }, allowed, {}, { standard: 'fast' })).toBe('fast');
    expect(hireModel({ role: 'backend' }, allowed)).toBeUndefined();
  });
});

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

describe('across providers', () => {
  const mixed = [
    ...CLAUDE.filter((m) => !/opus|fable/.test(m.ref)),
    { ref: 'openai:cli:gpt-5', name: 'GPT-5' },
    { ref: 'openai:cli:gpt-5-mini', name: 'GPT-5 mini' },
    { ref: 'google:gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
    { ref: 'ollama:qwen2.5-coder:7b', name: 'qwen2.5-coder:7b (7B)' },
    { ref: 'magpie:daily-coding', name: 'daily-coding (routing group)' },
  ];

  it('picks the strongest model of each level wherever it comes from', () => {
    const choice = chooseTiers(mixed);
    expect([...choice.peers.complex].sort()).toEqual(['google:gemini-2.5-pro', 'openai:cli:gpt-5']);
    expect(choice.tiers.standard).toBe('anthropic:cli:claude-sonnet-5-5');
    expect(choice.peers.simple).toContain('openai:cli:gpt-5-mini');
    expect(choice.peers.simple).toContain('anthropic:cli:claude-haiku-5-5');
    expect(suggestTiers([...mixed, claude('claude-opus-5-5', 'Claude Opus 5.5')]).complex).toBe('anthropic:cli:claude-opus-5-5');
  });

  it('ranks local models below hosted ones and treats unknown families as standard', () => {
    expect(profileOf({ ref: 'ollama:qwen2.5-coder:7b', name: 'qwen2.5-coder:7b' }).tier).toBe('simple');
    expect(profileOf({ ref: 'ollama:qwen2.5:32b', name: 'qwen2.5:32b' })).toEqual({ tier: 'standard', score: 55 });
    expect(profileOf({ ref: 'magpie:daily-coding', name: 'daily-coding (routing group)' }).tier).toBe('standard');
    expect(suggestTiers([{ ref: 'ollama:llama3:8b', name: 'llama3:8b' }, claude('claude-haiku-5-5', 'Claude Haiku 5.5')]).simple).toBe('anthropic:cli:claude-haiku-5-5');
  });

  it('prefers a subscription over a per-token API key for the same model', () => {
    expect(suggestTiers([{ ref: 'anthropic:claude-opus-5-5', name: 'Claude Opus 5.5' }, claude('claude-opus-5-5', 'Claude Opus 5.5')]).complex).toBe('anthropic:cli:claude-opus-5-5');
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

  it('fails over to the best model of the same level on another provider', () => {
    expect(fallbackForTier(providers, 'anthropic:cli:claude-opus-5-5', () => false)).toBe('openai:cli:gpt-5');
    expect(fallbackForTier(providers, 'anthropic:cli:claude-opus-5-5', (id) => id === 'openai')).toBeNull();
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

const GPT = [
  { ref: 'openai:cli:default', name: 'Codex CLI (configured default model)' },
  { ref: 'openai:cli:gpt-6.1-sol', name: 'GPT-6.1-Sol · Codex CLI' },
  { ref: 'openai:cli:gpt-6-astra', name: 'GPT-6-Astra · Codex CLI' },
  { ref: 'openai:cli:gpt-6.1-terra', name: 'GPT-6.1 Terra · Codex CLI' },
  { ref: 'openai:cli:gpt-6-luna', name: 'GPT-6-Luna · Codex CLI' },
  { ref: 'openai:cli:gpt-5.6-sol', name: 'GPT-5.6-Sol · Codex CLI' },
];

describe('reading GPT models', () => {
  it('understands Sol, Astra, Terra and Luna instead of calling GPT unknown', () => {
    expect(tierOf(GPT[1])).toBe('complex');
    expect(tierOf(GPT[2])).toBe('complex');
    expect(tierOf(GPT[3])).toBe('standard');
    expect(tierOf(GPT[4])).toBe('simple');
    expect(tierOf({ ref: 'openai:gpt-5', name: 'GPT-5' })).toBe('complex');
  });

  it('prefers GPT-6.1 over GPT-5.6, and Codex alone covers every level', () => {
    const choice = chooseTiers(GPT);
    expect(choice.tiers).toEqual({ complex: 'openai:cli:gpt-6.1-sol', standard: 'openai:cli:gpt-6.1-terra', simple: 'openai:cli:gpt-6-luna' });
  });

  it('sizes a model it has never seen by its price, borrowed from its Magpie copy', () => {
    const cheap = { ref: 'openai:cli:gpt-7-nova', name: 'GPT-7-Nova · Codex CLI' };
    expect(tierOf(cheap)).toBe('standard');
    const ranked = rankModels([cheap, { ref: 'magpie:codex/gpt-7-nova', name: 'GPT-7-Nova · Codex', price: 0.1 }]);
    expect(ranked.find((m) => m.ref === cheap.ref)?.tier).toBe('simple');
    expect(ranked.find((m) => m.ref === 'magpie:codex/gpt-7-nova')?.duplicateOf).toBe(cheap.ref);
  });

  it('excludes the "configured default" alias from the ranking', () => {
    expect(rankModels(GPT).some((m) => m.ref === 'openai:cli:default')).toBe(false);
  });
});

describe('fair sharing between providers', () => {
  const both = [...CLAUDE, ...GPT.filter((m) => !m.ref.endsWith('default'))];

  it('treats Opus 5.5 and GPT-6.1-Sol as complex peers and takes turns', () => {
    const choice = chooseTiers(both);
    expect(choice.peers.complex.length).toBeGreaterThan(1);
    const tasks = assignPlanModels([{ complexity: 'complex' as const }, { complexity: 'complex' as const }, { complexity: 'complex' as const }], choice, new Set());
    expect(new Set(tasks.map((t) => (t as { model?: string }).model)).size).toBe(2);
    expect(tasks[0].model).toBe(tasks[2].model);
  });

  it('keeps a deliberate model and lets a pin replace the peers', () => {
    const choice = chooseTiers(both);
    const kept = assignPlanModels([{ complexity: 'complex' as const, model: 'x:y' }], choice, new Set());
    expect(kept[0].model).toBe('x:y');
    const pinned = resolveRouting(both, { complex: 'anthropic:cli:claude-opus-5-5' });
    expect(pinned.peers.complex).toEqual(['anthropic:cli:claude-opus-5-5']);
  });

  it('marks Magpie copies as backups and keeps them out of the peers', () => {
    const copy = { ref: 'magpie:claude/claude-opus-5-5', name: 'Claude Opus 5.5 · Claude Code' };
    const ranked = rankModels([...CLAUDE, copy]);
    expect(ranked.find((m) => m.ref === copy.ref)?.duplicateOf).toBe('anthropic:cli:claude-opus-5-5');
    expect(chooseTiers([...CLAUDE, copy]).peers.complex).not.toContain(copy.ref);
  });
});

describe('learning from results', () => {
  it('needs 3 results, then moves the score between -10 and +5', () => {
    expect(learnedBonus(undefined)).toBe(0);
    expect(learnedBonus({ passed: 2, failed: 0 })).toBe(0);
    expect(learnedBonus({ passed: 10, failed: 0 })).toBe(5);
    expect(learnedBonus({ passed: 0, failed: 10 })).toBe(-10);
  });

  it('lets a failing model fall behind its peer', () => {
    const models = [claude('claude-opus-5-5', 'Claude Opus 5.5'), { ref: 'openai:cli:gpt-6.1-sol', name: 'GPT-6.1-Sol' }];
    const before = rankModels(models);
    const worse = rankModels(models, { 'Anthropic|claude opus 5.5': { passed: 0, failed: 5 } });
    expect(worse[0].ref).toBe('openai:cli:gpt-6.1-sol');
    expect(worse.find((m) => m.ref.includes('opus'))!.score).toBeLessThan(before.find((m) => m.ref.includes('opus'))!.score);
  });
});

describe('Codex names', () => {
  it('calls a Codex-named model large but not every model served through Codex', () => {
    expect(tierOf({ ref: 'openai:gpt-5-codex', name: 'GPT-5 Codex' })).toBe('complex');
    expect(tierOf({ ref: 'openai:cli:gpt-6.1-terra', name: 'GPT-6.1 Terra · Codex CLI' })).toBe('standard');
  });
});

describe('who decides each model', () => {
  const both = [...CLAUDE, ...GPT.filter((m) => !m.ref.endsWith('default'))];
  const choice = chooseTiers(both);
  const opus = 'anthropic:cli:claude-opus-5-5';
  const sonnet = 'anthropic:cli:claude-sonnet-5-5';
  const task = (extra: Record<string, unknown> = {}) => ({ complexity: 'complex' as const, agentId: 'agent-backend', ...extra });

  it('applies you, a locked agent, a locked level, Sovereign, your preferred model, then Auto', () => {
    const policy = { pinned: { complex: sonnet }, modes: { complex: 'preferred' as const }, lockedAgents: { 'agent-qa': 'openai:cli:gpt-6-luna' } };
    const [mine, agent, sovereign, preferred] = assignPlanModels(
      [task({ model: 'x:y', modelSource: 'you' }), task({ agentId: 'agent-qa', model: opus }), task({ model: opus, modelReason: 'long context' }), task()],
      choice,
      new Set(),
      () => false,
      policy
    );
    expect(mine).toMatchObject({ model: 'x:y', modelSource: 'you' });
    expect(agent).toMatchObject({ model: 'openai:cli:gpt-6-luna', modelSource: 'agent' });
    expect(sovereign).toMatchObject({ model: opus, modelSource: 'sovereign', modelReason: 'long context' });
    expect(preferred).toMatchObject({ model: sonnet, modelSource: 'preferred' });
    const [auto] = assignPlanModels([task({ complexity: 'simple' })], choice, new Set(), () => false, policy);
    expect(auto.modelSource).toBe('auto');
  });

  it('a locked level and Force my setup override Sovereign', () => {
    const locked = assignPlanModels([task({ model: opus })], choice, new Set(), () => false, { pinned: { complex: sonnet }, modes: { complex: 'locked' } });
    expect(locked[0]).toMatchObject({ model: sonnet, modelSource: 'locked' });
    const forced = assignPlanModels([task({ model: opus })], choice, new Set(), () => false, { pinned: { complex: sonnet }, force: true });
    expect(forced[0]).toMatchObject({ model: sonnet, modelSource: 'locked' });
    const forcedAuto = assignPlanModels([task({ model: opus, complexity: 'standard' })], choice, new Set(), () => false, { force: true });
    expect(forcedAuto[0].modelSource).toBe('auto');
  });

  it('re-routing does not mistake an earlier Auto or Preferred pick for Sovereign', () => {
    const once = assignPlanModels([task()], choice, new Set(), () => false, { pinned: { complex: sonnet } });
    const again = assignPlanModels(once, choice, new Set(), () => false, {});
    expect(again[0].modelSource).toBe('auto');
  });

  it('sends Auto levels to their Magpie group, but never pinned ones', () => {
    const groups = { complex: 'magpie:group/agenthq-complex' };
    expect(assignPlanModels([task()], choice, new Set(), () => false, { groups })[0]).toMatchObject({ model: groups.complex, modelSource: 'auto' });
    expect(assignPlanModels([task()], choice, new Set(), () => false, { groups, pinned: { complex: sonnet } })[0].model).toBe(sonnet);
  });

  it('avoids a peer whose subscription is nearly used up while another has room', () => {
    const low = (ref: string) => quotaKeyOf(ref) === 'claude';
    const tasks = assignPlanModels([task(), task(), task()], choice, new Set(), () => false, { low });
    expect(tasks.every((t) => t.model?.startsWith('openai:'))).toBe(true);
    const allLow = assignPlanModels([task()], choice, new Set(), () => false, { low: () => true });
    expect(allLow[0].model).toBeTruthy();
  });

  it('with complexity routing off, keeps the agent model unless Sovereign chose one, and Force removes that', () => {
    const [sov, plain] = assignAgentModels([task({ model: opus, modelReason: 'r' }), task()], new Set());
    expect(sov).toMatchObject({ model: opus, modelSource: 'sovereign' });
    expect(plain).toMatchObject({ modelSource: 'agent' });
    expect(plain.model).toBeUndefined();
    const [forced] = assignAgentModels([task({ model: opus, modelReason: 'r' })], new Set(), { force: true });
    expect(forced.model).toBeUndefined();
    expect(forced.modelReason).toBeUndefined();
  });
});

describe('Magpie groups', () => {
  it('maps each subscription', () => {
    expect(quotaKeyOf('anthropic:cli:claude-opus-5-5')).toBe('claude');
    expect(quotaKeyOf('openai:cli:gpt-6.1-sol')).toBe('codex');
    expect(quotaKeyOf('magpie:codex/gpt-6.2-sol')).toBe('codex');
    expect(quotaKeyOf('magpie:group/smart-coding')).toBeUndefined();
    expect(quotaKeyOf('anthropic:claude-opus-5-5')).toBeUndefined();
  });

  it('builds one group per level from the peers, joining direct models through their Magpie copy', () => {
    const models = [
      claude('claude-opus-5-5', 'Claude Opus 5.5'),
      { ref: 'openai:cli:gpt-6.1-sol', name: 'GPT-6.1-Sol · Codex CLI' },
      { ref: 'magpie:claude/claude-opus-5-5', name: 'Claude Opus 5.5 · Claude Code' },
      { ref: 'magpie:codex/gpt-6.1-sol', name: 'GPT-6.1-Sol · Codex' },
      { ref: 'ollama:llama3:8b', name: 'llama3:8b' },
    ];
    const ranked = rankModels(models);
    const groups = magpieGroupsFor(ranked, chooseTiers(models).peers);
    const complex = groups.find((g) => g.tier === 'complex')!;
    expect(complex.id).toBe('agenthq-complex');
    expect([...complex.models].sort()).toEqual(['claude/claude-opus-5-5', 'codex/gpt-6.1-sol']);
    expect(complex.weights['claude/claude-opus-5-5']).toBeGreaterThan(1);
    expect(groups.find((g) => g.tier === 'simple')).toBeUndefined();
  });

  it('keeps its own groups out of the models agents are offered', () => {
    const magpie = provider('magpie', 'Magpie', [{ ref: 'magpie:group/agenthq-complex', name: 'agenthq-complex · routing group' }, { ref: 'magpie:group/smart-coding', name: 'smart-coding · routing group' }]);
    const refs = routingFor([magpie], { scope: 'any', overrides: {}, sovereignModel: '' }).models.map((m) => m.ref);
    expect(refs).toEqual(['magpie:group/smart-coding']);
    expect(isManagedGroup('magpie:group/agenthq-simple')).toBe(true);
    expect(snapshotModels([magpie]).magpie.map((m) => m.ref)).toEqual(['magpie:group/smart-coding']);
  });

  it('reads the reason Sovereign gives for a model, only with a model', () => {
    const plan = parsePlan(JSON.stringify({ summary: 's', tasks: [{ id: 't1', title: 'A', agentId: 'agent-backend', model: 'm:1', modelReason: ' long context ' }, { id: 't2', title: 'B', agentId: 'agent-backend', modelReason: 'no model' }] }), DEFAULT_AGENTS);
    expect(plan.tasks[0].modelReason).toBe('long context');
    expect(plan.tasks[1].modelReason).toBeUndefined();
  });
});
