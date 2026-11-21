import { providerOfRef, type AIModelId, type Complexity, type ModelScope, type ProviderState } from '@/types';

export const COMPLEXITIES: Complexity[] = ['simple', 'standard', 'complex'];

export const COMPLEXITY_LABEL: Record<Complexity, string> = {
  simple: 'Simple',
  standard: 'Standard',
  complex: 'Complex',
};

export const COMPLEXITY_HINT: Record<Complexity, string> = {
  simple: 'Small edits, renames, docs, config and well-scoped junior work',
  standard: 'Normal features, components, endpoints and tests',
  complex: 'Architecture, security, concurrency, hard bugs and cross-cutting changes',
};

export interface RoutingModel {
  ref: AIModelId;
  name: string;
}

interface Profile {
  match: RegExp;
  tier: Complexity;
  /** Rough strength for coding work, 0-100. Only used to compare models with each other. */
  score: number;
}

/**
 * Known model families from every provider, strongest first within a tier. First match wins, so the
 * small variants (mini, nano, flash) come before the family they belong to. Anything unknown is
 * treated as a standard model, so a brand-new family still works and can be pinned in Settings.
 */
const PROFILES: Profile[] = [
  { match: /opus/, tier: 'complex', score: 95 },
  { match: /fable/, tier: 'complex', score: 94 },
  { match: /sonnet/, tier: 'standard', score: 85 },
  { match: /haiku/, tier: 'simple', score: 62 },
  { match: /\bnano\b/, tier: 'simple', score: 45 },
  { match: /flash-?lite|\blite\b/, tier: 'simple', score: 50 },
  { match: /\bsmall\b/, tier: 'simple', score: 50 },
  { match: /\bmini\b/, tier: 'simple', score: 64 },
  { match: /\bflash\b/, tier: 'simple', score: 66 },
  { match: /gpt-?5/, tier: 'complex', score: 90 },
  { match: /\bo[1345]\b/, tier: 'complex', score: 88 },
  { match: /\bpro\b/, tier: 'complex', score: 88 },
  { match: /\bultra\b|\blarge\b|\bmax\b/, tier: 'complex', score: 80 },
  { match: /gpt-?4/, tier: 'standard', score: 72 },
  { match: /\bmedium\b/, tier: 'standard', score: 70 },
];

function text(model: RoutingModel): string {
  return `${model.name} ${model.ref}`.toLowerCase().replace(/[_:/()]/g, ' ');
}

/** Parameter size of a local model ("qwen2.5:32b" → 32), if it says. */
function paramsOf(model: RoutingModel): number | undefined {
  const m = /(\d+(?:\.\d+)?)\s*b\b/.exec(text(model));
  return m ? Number(m[1]) : undefined;
}

/** Tier and strength of a model. Local Ollama models are free but weaker, so they rank below hosted ones. */
export function profileOf(model: RoutingModel): { tier: Complexity; score: number } {
  if (providerOfRef(model.ref) === 'ollama') {
    const size = paramsOf(model) ?? 7;
    return size >= 30 ? { tier: 'standard', score: 55 } : { tier: 'simple', score: Math.min(48, 30 + size) };
  }
  const t = text(model);
  const hit = PROFILES.find((p) => p.match.test(t));
  return hit ? { tier: hit.tier, score: hit.score } : { tier: 'standard', score: 70 };
}

export function tierOf(model: RoutingModel): Complexity {
  return profileOf(model).tier;
}

/** Version numbers in a model id ("claude-opus-5-5" → [5, 5]); dates such as 20251001 are ignored. */
export function versionOf(ref: AIModelId): number[] {
  const id = ref.slice(ref.indexOf(':') + 1).replace(/^cli:/, '');
  return (id.match(/\d+/g) ?? []).filter((n) => n.length < 6).map(Number);
}

export function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Subscriptions (signed-in CLIs), Magpie and local models are flat-rate; API keys are billed per token. */
function flatRate(ref: AIModelId): boolean {
  const provider = providerOfRef(ref);
  return ref.includes(':cli:') || provider === 'magpie' || provider === 'ollama';
}

/** Stronger first; within a family the newest version; then flat-rate over per-token. */
export function compareModels(a: RoutingModel, b: RoutingModel): number {
  return profileOf(b).score - profileOf(a).score || compareVersions(versionOf(b.ref), versionOf(a.ref)) || Number(flatRate(b.ref)) - Number(flatRate(a.ref));
}

/**
 * The best model for each tier across every provider given: the strongest model of that tier,
 * newest version first. A model released later is picked up as soon as its provider lists it.
 * A tier with no model of its own borrows from its neighbours.
 */
export function suggestTiers(models: RoutingModel[]): Record<Complexity, AIModelId> {
  const best = (tier: Complexity) => [...models].filter((m) => tierOf(m) === tier).sort(compareModels)[0]?.ref;
  const found = { simple: best('simple'), standard: best('standard'), complex: best('complex') };
  const any = [...models].sort(compareModels)[0]?.ref ?? '';
  return {
    simple: found.simple ?? found.standard ?? found.complex ?? any,
    standard: found.standard ?? found.complex ?? found.simple ?? any,
    complex: found.complex ?? found.standard ?? found.simple ?? any,
  };
}

/** Suggested tiers with the user's own choices on top, as long as those models are still in scope. */
export function resolveTiers(models: RoutingModel[], overrides: Partial<Record<Complexity, AIModelId>> = {}): Record<Complexity, AIModelId> {
  const suggested = suggestTiers(models);
  const inScope = new Set(models.map((m) => m.ref));
  const out = { ...suggested };
  for (const tier of COMPLEXITIES) {
    const chosen = overrides[tier];
    if (chosen && inScope.has(chosen)) out[tier] = chosen;
  }
  return out;
}

/** With scope `sovereign`, only models of the provider Sovereign itself runs on (one subscription). */
export function scopeModels<T extends RoutingModel>(models: T[], scope: ModelScope, sovereignModel: AIModelId | undefined): T[] {
  if (scope !== 'sovereign') return models;
  const provider = providerOfRef(sovereignModel);
  if (!provider) return models;
  const same = models.filter((m) => providerOfRef(m.ref) === provider);
  return same.length ? same : models;
}

export function parseComplexity(value: unknown): Complexity | undefined {
  const v = String(value ?? '').trim().toLowerCase();
  if (v === 'simple' || v === 'easy' || v === 'low' || v === 'trivial') return 'simple';
  if (v === 'standard' || v === 'medium' || v === 'moderate' || v === 'normal') return 'standard';
  if (v === 'complex' || v === 'hard' || v === 'high' || v === 'difficult') return 'complex';
  return undefined;
}

/** Complexity Sovereign gave the task, or a guess from its stage and whether a junior does it. */
export function taskComplexity(task: { complexity?: Complexity; stage?: string; priority?: string }, junior = false): Complexity {
  if (task.complexity) return task.complexity;
  if (junior) return 'simple';
  if (task.stage === 'architecture' || task.priority === 'critical') return 'complex';
  return 'standard';
}

/**
 * The model a task runs on: a model Sovereign or the user set explicitly (if it is in scope),
 * otherwise the model for the task's complexity.
 */
export function routeTaskModel(
  task: { model?: AIModelId; complexity?: Complexity; stage?: string; priority?: string },
  tiers: Record<Complexity, AIModelId>,
  allowed: ReadonlySet<AIModelId>,
  junior = false
): AIModelId | undefined {
  if (task.model && (!allowed.size || allowed.has(task.model))) return task.model;
  return tiers[taskComplexity(task, junior)] || undefined;
}

export interface RoutingSettings {
  scope: ModelScope;
  overrides: Partial<Record<Complexity, AIModelId>>;
  sovereignModel: AIModelId | undefined;
  /** Providers to leave out, such as ones out of credit. */
  skip?: (providerId: string) => boolean;
}

/** The models agents may use and the model for each complexity, from the live provider lists. */
export function routingFor(providers: ProviderState[], settings: RoutingSettings): { models: Array<RoutingModel & { provider: string; contextWindow?: number }>; tiers: Record<Complexity, AIModelId> } {
  const all = providers
    .filter((p) => p.connection && !settings.skip?.(p.id))
    .flatMap((p) => p.models.filter((m) => m.selectable !== false).map((m) => ({ ref: m.ref, name: m.name, provider: p.name, contextWindow: m.contextWindow })));
  const canonical = providers.flatMap((p) => p.models).find((m) => m.ref === settings.sovereignModel)?.canonicalRef ?? settings.sovereignModel;
  const models = scopeModels(all, settings.scope, canonical);
  return { models, tiers: resolveTiers(models, settings.overrides) };
}

/**
 * When a provider runs out of credit: the best model of the same level on another provider that is
 * still available (an Opus task moves to the strongest complex model elsewhere, a Haiku task to a cheap one).
 */
export function fallbackForTier(providers: ProviderState[], failedRef: AIModelId, unavailable: (providerId: string) => boolean): AIModelId | null {
  const failedProvider = providerOfRef(failedRef);
  const known = providers.flatMap((p) => p.models).find((m) => m.ref === failedRef);
  const tier = tierOf({ ref: known?.canonicalRef ?? failedRef, name: known?.name ?? failedRef });
  const { models, tiers } = routingFor(providers, { scope: 'any', overrides: {}, sovereignModel: undefined, skip: (id) => id === failedProvider || unavailable(id) });
  return models.length ? tiers[tier] || null : null;
}
