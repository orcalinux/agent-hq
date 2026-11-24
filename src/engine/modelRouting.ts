import { providerOfRef, type AIModelId, type Complexity, type LevelMode, type ModelScope, type ModelSource, type ProviderState } from '@/types';

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
  /** Input price in USD per million tokens, when the provider says. Bigger models cost more. */
  price?: number;
}

/** Size class of a model inside its own family line-up. Every provider is scored on the same scale. */
type SizeClass = 'large' | 'mid' | 'small' | 'unknown';

const CLASS_TIER: Record<SizeClass, Complexity> = { large: 'complex', mid: 'standard', small: 'simple', unknown: 'standard' };
/** Same numbers for every provider, so no vendor wins just by being listed here. */
const CLASS_SCORE: Record<SizeClass, number> = { large: 90, mid: 80, small: 60, unknown: 75 };
const CLASS_LABEL: Record<SizeClass, string> = { large: 'Large model', mid: 'Mid-size model', small: 'Small, fast model', unknown: 'Unknown family, treated as mid-size' };
const PRICE_LABEL = 'sized by its price';

function text(model: RoutingModel): string {
  return `${model.name} ${model.ref}`.toLowerCase().replace(/[_:/()]/g, ' ');
}

/** The company that trained the model, whichever provider or gateway serves it. */
export function vendorOf(model: RoutingModel): string {
  const t = text(model);
  if (providerOfRef(model.ref) === 'ollama') return 'local';
  if (/claude|opus|sonnet|haiku|fable/.test(t)) return 'Anthropic';
  if (/\bgpt|codex|\bo[1-9]\b/.test(t)) return 'OpenAI';
  if (/gemini/.test(t)) return 'Google';
  return providerOfRef(model.ref) ?? 'other';
}

function sizeClass(model: RoutingModel): SizeClass {
  const t = text(model);
  if (/\bnano\b|\bmini\b|flash-?lite|\blite\b|\bsmall\b|haiku|\bflash\b|\bluna\b/.test(t)) return 'small';
  if (/opus|fable|\bultra\b|\blarge\b|\bmax\b|\bpro\b|\bo[1-9]\b|\bastra\b|\bsol\b/.test(t)) return 'large';
  if (/sonnet|\bmedium\b|gemini|\bterra\b/.test(t)) return 'mid';
  if (/\bcodex\b/.test(model.name.split(' · ')[0].toLowerCase())) return 'large';
  if (model.price !== undefined) return model.price >= 3 ? 'large' : model.price >= 0.8 ? 'mid' : 'small';
  if (/^gpt[- ]?\d+(\.\d+)?$/.test(model.name.split(' · ')[0].trim().toLowerCase())) return 'large';
  return 'unknown';
}

/** Parameter size of a local model ("qwen2.5:32b" → 32), if it says. */
function paramsOf(model: RoutingModel): number | undefined {
  const m = /(\d+(?:\.\d+)?)\s*b\b/.exec(text(model));
  return m ? Number(m[1]) : undefined;
}

/**
 * Level and base strength of one model on its own. Hosted models: large 90, mid 80, small 60,
 * unknown 75, the same for every vendor. Local Ollama models are free but weaker, so they rank lower.
 */
export function profileOf(model: RoutingModel): { tier: Complexity; score: number } {
  if (providerOfRef(model.ref) === 'ollama') {
    const size = paramsOf(model) ?? 7;
    return size >= 30 ? { tier: 'standard', score: 55 } : { tier: 'simple', score: Math.min(48, 30 + size) };
  }
  const size = sizeClass(model);
  return { tier: CLASS_TIER[size], score: CLASS_SCORE[size] };
}

export function tierOf(model: RoutingModel): Complexity {
  return profileOf(model).tier;
}

/** Version numbers in a model id ("claude-opus-5-5" → [5, 5]); dates such as 20251001 are ignored. */
export function versionOf(ref: AIModelId, name = ''): number[] {
  const id = ref.slice(ref.indexOf(':') + 1).replace(/^cli:/, '');
  const pick = (s: string) => (s.match(/\d+/g) ?? []).filter((n) => n.length < 6).map(Number);
  const fromId = pick(id);
  return fromId.length ? fromId : pick(name);
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

/** Same model, whoever serves it: "Claude Opus 5.5 · Claude Code" via Magpie is Claude Opus 5.5. */
export function modelKey(model: RoutingModel): string {
  const name = model.name.split(' · ')[0].replace(/\(latest\)/i, '').trim().toLowerCase();
  return `${vendorOf(model)}|${name || model.ref}`;
}

function isAlias(ref: AIModelId): boolean {
  return /:(cli:)?default$/.test(ref);
}

export interface ModelResult {
  passed: number;
  failed: number;
}
export type ModelResults = Record<string, ModelResult>;

/** Points from real results on your projects, once a model has at least 3: -10 to +5. */
export function learnedBonus(result: ModelResult | undefined): number {
  if (!result) return 0;
  const total = result.passed + result.failed;
  if (total < 3) return 0;
  return Math.max(-10, Math.min(5, Math.round((result.passed / total - 0.75) * 20)));
}

export interface RankedModel extends RoutingModel {
  provider?: string;
  contextWindow?: number;
  vendor: string;
  tier: Complexity;
  base: number;
  /** Points lost for being an older version than the vendor's newest model of the same size. */
  agePenalty: number;
  learned: number;
  score: number;
  results?: ModelResult;
  /** Set when the same model is also offered directly; this copy is only used if that one is unavailable. */
  duplicateOf?: AIModelId;
  why: string;
}

/** Stronger first, then newer, then flat-rate over per-token; ties keep the providers' order. */
function byStrength(a: RankedModel, b: RankedModel): number {
  return b.score - a.score || compareVersions(versionOf(b.ref, b.name), versionOf(a.ref, a.name)) || Number(flatRate(b.ref)) - Number(flatRate(a.ref));
}

/**
 * Scores every model in context: the base for its size, minus 3 points per newer version the same
 * vendor has at that size (at most 9), plus what real results taught. A copy of a model that is also
 * offered directly (Claude through Magpie when Claude Code is connected) is marked as a duplicate.
 */
export function rankModels<T extends RoutingModel & { provider?: string; contextWindow?: number }>(input: T[], results: ModelResults = {}): Array<RankedModel & T> {
  const priceByKey = new Map<string, number>();
  for (const m of input) if (m.price !== undefined && !priceByKey.has(modelKey(m))) priceByKey.set(modelKey(m), m.price);
  const enriched = input.map((m) => (m.price === undefined && priceByKey.has(modelKey(m)) ? { ...m, price: priceByKey.get(modelKey(m)) } : m));
  const models = enriched.some((m) => !isAlias(m.ref)) ? enriched.filter((m) => !isAlias(m.ref)) : enriched;
  const versions = new Map<string, number[][]>();
  for (const m of models) {
    const group = `${vendorOf(m)}|${tierOf(m)}`;
    const v = versionOf(m.ref, m.name);
    const list = versions.get(group) ?? [];
    if (!list.some((x) => compareVersions(x, v) === 0)) list.push(v);
    versions.set(group, list);
  }
  for (const list of versions.values()) list.sort((a, b) => compareVersions(b, a));
  const direct = new Map<string, AIModelId>();
  for (const m of models) if (providerOfRef(m.ref) !== 'magpie' && !direct.has(modelKey(m))) direct.set(modelKey(m), m.ref);

  const ranked = models.map((m) => {
    const { tier, score: base } = profileOf(m);
    const vendor = vendorOf(m);
    const index = versions.get(`${vendor}|${tier}`)!.findIndex((x) => compareVersions(x, versionOf(m.ref, m.name)) === 0);
    const agePenalty = Math.min(9, 3 * index);
    const res = results[modelKey(m)];
    const learned = learnedBonus(res);
    const dup = providerOfRef(m.ref) === 'magpie' ? direct.get(modelKey(m)) : undefined;
    const size = providerOfRef(m.ref) === 'ollama' ? null : sizeClass(m);
    const parts = [
      size ? `${CLASS_LABEL[size]}${m.price !== undefined && size !== 'unknown' && !/opus|fable|sonnet|haiku|luna|sol\b|terra|astra/i.test(text(m)) ? ` (${PRICE_LABEL})` : ''}` : 'Local model, free but weaker',
      index === 0 ? `newest ${vendor === 'local' ? 'local' : vendor} at this size` : `${index} newer version${index === 1 ? '' : 's'} exist (−${agePenalty})`,
      learned ? `${learned > 0 ? '+' : ''}${learned} from ${res!.passed + res!.failed} real tasks` : '',
      dup ? 'also offered directly, used as backup' : '',
    ].filter(Boolean);
    return { ...m, vendor, tier, base, agePenalty, learned, score: base - agePenalty + learned, results: res, ...(dup ? { duplicateOf: dup } : {}), why: parts.join(' · ') } as RankedModel & T;
  });
  return ranked.sort(byStrength);
}

/** Stronger first; within a family the newest version; then flat-rate over per-token. */
export function compareModels(a: RoutingModel, b: RoutingModel): number {
  const ranked = rankModels([a, b]);
  return ranked[0].ref === a.ref ? -1 : ranked[0].ref === b.ref && a.ref !== b.ref ? 1 : 0;
}

/** Models within this many points of the best are treated as equally good and share the work. */
export const PEER_MARGIN = 2;

export interface TierChoice {
  /** The best model for each level. */
  tiers: Record<Complexity, AIModelId>;
  /** Equally good models from different vendors for each level; tasks take turns between them. */
  peers: Record<Complexity, AIModelId[]>;
}

/**
 * The best model for each level across every provider given. Equally strong models from different
 * vendors become peers that share the work. A level with no model of its own borrows from its neighbours.
 */
export function chooseTiers(models: RoutingModel[], results: ModelResults = {}): TierChoice {
  const ranked = rankModels(models, results);
  const usable = ranked.filter((m) => !m.duplicateOf);
  const peersOf = (tier: Complexity): AIModelId[] => {
    const inTier = usable.filter((m) => m.tier === tier);
    if (!inTier.length) return [];
    const top = inTier[0].score;
    const seen = new Set<string>();
    return inTier.filter((m) => m.score >= top - PEER_MARGIN && !seen.has(m.vendor) && seen.add(m.vendor)).map((m) => m.ref);
  };
  const found = { simple: peersOf('simple'), standard: peersOf('standard'), complex: peersOf('complex') };
  const any = usable[0]?.ref ? [usable[0].ref] : [];
  const peers: Record<Complexity, AIModelId[]> = {
    simple: found.simple.length ? found.simple : found.standard.length ? found.standard : found.complex.length ? found.complex : any,
    standard: found.standard.length ? found.standard : found.complex.length ? found.complex : found.simple.length ? found.simple : any,
    complex: found.complex.length ? found.complex : found.standard.length ? found.standard : found.simple.length ? found.simple : any,
  };
  return { peers, tiers: { simple: peers.simple[0] ?? '', standard: peers.standard[0] ?? '', complex: peers.complex[0] ?? '' } };
}

export function suggestTiers(models: RoutingModel[], results: ModelResults = {}): Record<Complexity, AIModelId> {
  return chooseTiers(models, results).tiers;
}

/** Suggested levels with the user's pinned models on top, as long as those models are still offered. */
export function resolveRouting(models: RoutingModel[], overrides: Partial<Record<Complexity, AIModelId>> = {}, results: ModelResults = {}): TierChoice {
  const choice = chooseTiers(models, results);
  const inScope = new Set(models.map((m) => m.ref));
  const out: TierChoice = { tiers: { ...choice.tiers }, peers: { ...choice.peers } };
  for (const tier of COMPLEXITIES) {
    const chosen = overrides[tier];
    if (chosen && inScope.has(chosen)) {
      out.tiers[tier] = chosen;
      out.peers[tier] = [chosen];
    }
  }
  return out;
}

export function resolveTiers(models: RoutingModel[], overrides: Partial<Record<Complexity, AIModelId>> = {}, results: ModelResults = {}): Record<Complexity, AIModelId> {
  return resolveRouting(models, overrides, results).tiers;
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

export const SOURCE_LABEL: Record<ModelSource, string> = {
  you: 'You',
  agent: "Agent's model",
  locked: 'Locked',
  sovereign: 'Sovereign',
  preferred: 'Preferred',
  auto: 'Auto',
};

export const SOURCE_HINT: Record<ModelSource, string> = {
  you: 'You chose this model in the plan.',
  agent: "The agent's own model is used.",
  locked: 'Your locked setup; nothing changes it.',
  sovereign: 'Sovereign chose this model for the task.',
  preferred: 'Your preferred model for this level.',
  auto: 'The strongest model for this level right now.',
};

/** Groups Agent HQ keeps in Magpie, one per level. */
export const MAGPIE_GROUP: Record<Complexity, string> = { simple: 'agenthq-simple', standard: 'agenthq-standard', complex: 'agenthq-complex' };

export function isGroupRef(ref: AIModelId | undefined): boolean {
  return Boolean(ref && /^magpie:group\//.test(ref));
}

export function isManagedGroup(ref: AIModelId | undefined): boolean {
  return Boolean(ref && /^magpie:group\/agenthq-/.test(ref));
}

/** Your manual setup, and how strictly it applies. */
export interface RoutingPolicy {
  /** Models pinned per level (only those still offered). */
  pinned?: Partial<Record<Complexity, AIModelId>>;
  /** Preferred (default) or Locked, per pinned level. */
  modes?: Partial<Record<Complexity, LevelMode>>;
  /** Force my setup: every pin is locked and Sovereign's own model choices are ignored. */
  force?: boolean;
  /** Agents whose own model is locked: agent id → model. */
  lockedAgents?: Record<string, AIModelId>;
  /** Magpie groups that stand in for Auto levels, letting Magpie pick the account. */
  groups?: Partial<Record<Complexity, AIModelId>>;
  /** Models whose subscription is nearly used up; avoided while a peer still has room. */
  low?: (ref: AIModelId) => boolean;
}

type RoutableTask = { model?: AIModelId; complexity?: Complexity; stage?: string; priority?: string; agentId?: string; modelSource?: ModelSource; modelReason?: string };

/**
 * Models for every task of a plan, and who chose each. In order: a model you set in the plan, an agent's
 * locked model, a locked level (or every pin under Force my setup), Sovereign's own choice, your preferred
 * model for the level, then Auto: the level's Magpie group, or its equally good peers taking turns.
 */
export function assignPlanModels<T extends RoutableTask>(
  tasks: T[],
  choice: TierChoice,
  allowed: ReadonlySet<AIModelId>,
  isJunior: (task: T) => boolean = () => false,
  policy: RoutingPolicy = {}
): T[] {
  const turn: Record<Complexity, number> = { simple: 0, standard: 0, complex: 0 };
  const ok = (ref: AIModelId | undefined): ref is AIModelId => Boolean(ref && (!allowed.size || allowed.has(ref)));
  return tasks.map((t) => {
    if (t.modelSource === 'you' && t.model) return t;
    const agentModel = t.agentId ? policy.lockedAgents?.[t.agentId] : undefined;
    if (agentModel) return { ...t, model: agentModel, modelSource: 'agent' as const };
    const tier = taskComplexity(t, isJunior(t));
    const pin = policy.pinned?.[tier];
    if (ok(pin) && (policy.force || policy.modes?.[tier] === 'locked')) return { ...t, model: pin, modelSource: 'locked' as const };
    if (ok(t.model) && !policy.force && (!t.modelSource || t.modelSource === 'sovereign')) return { ...t, modelSource: 'sovereign' as const };
    if (ok(pin)) return { ...t, model: pin, modelSource: 'preferred' as const };
    const group = policy.groups?.[tier];
    if (group) return { ...t, model: group, modelSource: 'auto' as const };
    const all = choice.peers[tier].length ? choice.peers[tier] : [choice.tiers[tier]].filter(Boolean);
    const roomy = policy.low ? all.filter((r) => !policy.low!(r)) : all;
    const peers = roomy.length ? roomy : all;
    const model = peers.length ? peers[turn[tier]++ % peers.length] : undefined;
    return model ? { ...t, model, modelSource: 'auto' as const } : t;
  });
}

/**
 * With complexity routing off, tasks run on their agent's model unless you or Sovereign chose one;
 * locked agents and Force my setup still win over Sovereign.
 */
export function assignAgentModels<T extends RoutableTask>(tasks: T[], allowed: ReadonlySet<AIModelId>, policy: RoutingPolicy = {}): T[] {
  return tasks.map((t) => {
    if (t.modelSource === 'you' && t.model) return t;
    const agentModel = t.agentId ? policy.lockedAgents?.[t.agentId] : undefined;
    if (agentModel) return { ...t, model: agentModel, modelSource: 'agent' as const };
    if (t.model && !policy.force && (!allowed.size || allowed.has(t.model))) return { ...t, modelSource: 'sovereign' as const };
    const rest = { ...t, modelSource: 'agent' as const };
    delete rest.model;
    delete rest.modelReason;
    return rest;
  });
}

/** The level a newly hired agent works at: juniors do simple work, architects and QA complex work. */
export function hireLevel(hire: { junior?: boolean; role?: string }): Complexity {
  return hire.junior ? 'simple' : hire.role === 'architect' || hire.role === 'qa' ? 'complex' : 'standard';
}

/**
 * The model a newly hired agent gets. Your setup wins: with Force or a locked level, Sovereign's suggestion
 * is ignored and the level's pinned model is used (or, with none, the role default by returning undefined).
 * Otherwise Sovereign's suggestion stands when it is in scope, else the level's model.
 */
export function hireModel(hire: { model?: AIModelId; junior?: boolean; role?: string }, allowed: ReadonlySet<AIModelId>, policy: RoutingPolicy = {}, tiers: Partial<Record<Complexity, AIModelId>> = {}): AIModelId | undefined {
  const level = hireLevel(hire);
  const pinned = policy.pinned?.[level];
  if (policy.force || policy.modes?.[level] === 'locked') return pinned && (!allowed.size || allowed.has(pinned)) ? pinned : undefined;
  if (hire.model && (!allowed.size || allowed.has(hire.model))) return hire.model;
  return tiers[level] || pinned || undefined;
}

/** Which subscription a model draws on, for quota checks: Magpie's provider id ("claude", "codex"…). */
export function quotaKeyOf(ref: AIModelId): string | undefined {
  const viaMagpie = /^magpie:([^/]+)\//.exec(ref);
  if (viaMagpie) return viaMagpie[1] === 'group' ? undefined : viaMagpie[1];
  if (ref.startsWith('anthropic:cli:')) return 'claude';
  if (ref.startsWith('openai:cli:')) return 'codex';
  if (ref.startsWith('google:cli:')) return 'gemini';
  return undefined;
}

/**
 * The Magpie group for each level: the level's peers, each mapped to its Magpie id (a model you have
 * directly joins through its Magpie copy), weighted by score. Levels with no model in Magpie are left out.
 */
export function magpieGroupsFor(ranked: RankedModel[], peers: Record<Complexity, AIModelId[]>): Array<{ tier: Complexity; id: string; models: string[]; weights: Record<string, number> }> {
  const magpieId = (ref: AIModelId): string | undefined => {
    if (ref.startsWith('magpie:')) return isGroupRef(ref) ? undefined : ref.slice('magpie:'.length);
    const copy = ranked.find((m) => m.duplicateOf === ref);
    return copy ? copy.ref.slice('magpie:'.length) : undefined;
  };
  return COMPLEXITIES.flatMap((tier) => {
    const members = peers[tier].flatMap((ref) => {
      const id = magpieId(ref);
      return id ? [{ id, score: ranked.find((m) => m.ref === ref)?.score ?? 50 }] : [];
    });
    if (!members.length) return [];
    return [{ tier, id: MAGPIE_GROUP[tier], models: members.map((m) => m.id), weights: Object.fromEntries(members.map((m) => [m.id, Math.max(1, m.score)])) }];
  });
}

export interface RoutingSettings {
  scope: ModelScope;
  overrides: Partial<Record<Complexity, AIModelId>>;
  sovereignModel: AIModelId | undefined;
  /** Providers to leave out, such as ones out of credit. */
  skip?: (providerId: string) => boolean;
  /** Real results per model, which nudge the ranking. */
  results?: ModelResults;
}

/** The models agents may use and the model for each complexity, from the live provider lists. */
export function routingFor(providers: ProviderState[], settings: RoutingSettings): { models: Array<RoutingModel & { provider: string; contextWindow?: number }>; tiers: Record<Complexity, AIModelId>; peers: Record<Complexity, AIModelId[]> } {
  const all = providers
    .filter((p) => p.connection && !settings.skip?.(p.id))
    .flatMap((p) => p.models.filter((m) => m.selectable !== false && !isManagedGroup(m.ref)).map((m) => ({ ref: m.ref, name: m.name, provider: p.name, contextWindow: m.contextWindow, price: m.pricing?.inputPerM })));
  const canonical = providers.flatMap((p) => p.models).find((m) => m.ref === settings.sovereignModel)?.canonicalRef ?? settings.sovereignModel;
  const models = scopeModels(all, settings.scope, canonical);
  return { models, ...resolveRouting(models, settings.overrides, settings.results) };
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
