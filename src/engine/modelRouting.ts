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

const FAMILY: Record<Complexity, RegExp[]> = {
  simple: [/haiku/, /\bnano\b/, /\bmini\b/, /flash-?lite/, /\bflash\b/, /\blite\b/, /\bsmall\b/],
  standard: [/sonnet/, /\bmedium\b/],
  complex: [/opus/, /fable/, /\bultra\b/, /\bpro\b/, /\blarge\b/, /\bmax\b/],
};

function text(model: RoutingModel): string {
  return `${model.name} ${model.ref}`.toLowerCase().replace(/[_:/]/g, ' ');
}

export function tierOf(model: RoutingModel): Complexity {
  const t = text(model);
  if (FAMILY.simple.some((re) => re.test(t))) return 'simple';
  if (FAMILY.complex.some((re) => re.test(t))) return 'complex';
  return 'standard';
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

function newest<T extends RoutingModel>(models: T[]): T | undefined {
  return models.reduce<T | undefined>((best, m) => (!best || compareVersions(versionOf(m.ref), versionOf(best.ref)) > 0 ? m : best), undefined);
}

/**
 * The best model for each tier: the first family that matches (Opus before Fable, Haiku before mini…),
 * and inside it the newest version. A model released later is picked up as soon as the provider lists it.
 */
export function suggestTiers(models: RoutingModel[]): Record<Complexity, AIModelId> {
  const pick = (tier: Complexity): AIModelId | undefined => {
    const inTier = models.filter((m) => tierOf(m) === tier);
    for (const re of FAMILY[tier]) {
      const hit = newest(inTier.filter((m) => re.test(text(m))));
      if (hit) return hit.ref;
    }
    return newest(inTier)?.ref;
  };
  const found = { simple: pick('simple'), standard: pick('standard'), complex: pick('complex') };
  const any = models[0]?.ref ?? '';
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
