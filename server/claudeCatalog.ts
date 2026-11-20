import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

export interface ClaudeRates {
  inputPerM: number;
  outputPerM: number;
  cacheReadPerM?: number;
  cacheWritePerM?: number;
  cacheWrite1hPerM?: number;
}

export interface ClaudePricing extends ClaudeRates {
  source: 'account';
  longPrompt?: ClaudeRates & { abovePromptTokens: number };
}

export interface ClaudeCatalogModel {
  id: string;
  name: string;
  contextWindow?: number;
  capabilities: string[];
  pricing?: ClaudePricing;
}

export interface ClaudeCatalog {
  models: ClaudeCatalogModel[];
  deniedIds: string[];
}

export function claudeModelId(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  const id = value.trim().replace(/\[(?:1m|200k)\]$/i, '');
  return /^claude-[a-z0-9]+(?:-[a-z0-9]+)+$/.test(id) ? id : undefined;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (value && typeof value === 'object' && !Array.isArray(value)) return object(value);
  } catch {
    return;
  }
}

function rate(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 10_000 ? value : undefined;
}

function rates(value: unknown): ClaudeRates | undefined {
  const card = object(value);
  const inputPerM = rate(card.inputTokens);
  const outputPerM = rate(card.outputTokens);
  if (!inputPerM || !outputPerM) return;
  const optional = {
    cacheReadPerM: rate(card.promptCacheReadTokens),
    cacheWritePerM: rate(card.promptCacheWriteTokens),
    cacheWrite1hPerM: rate(card.promptCacheWrite1hTokens),
  };
  return {
    inputPerM, outputPerM,
    ...Object.fromEntries(Object.entries(optional).filter(([, v]) => v !== undefined)),
  };
}

/** Per-model API rates Claude Code caches for the signed-in account, in USD per 1M tokens. */
export function claudeAccountPricing(costs: unknown, id: string): ClaudePricing | undefined {
  const card = object(costs)[id];
  const base = rates(card);
  if (!base) return;
  const long = object(object(card).longPrompt);
  const above = long.abovePromptTokens;
  const longRates = rates(long);
  return {
    ...base,
    source: 'account',
    ...(longRates && typeof above === 'number' && Number.isInteger(above) && above > 0
      ? { longPrompt: { ...longRates, abovePromptTokens: above } }
      : {}),
  };
}

export function readClaudeCatalog(configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')): ClaudeCatalog {
  const custom = Boolean(process.env.CLAUDE_CONFIG_DIR) || configDir !== path.join(os.homedir(), '.claude');
  const profile = custom
    ? readJson(path.join(configDir, '.claude.json'))
    : readJson(path.join(os.homedir(), '.claude.json')) ?? readJson(path.join(configDir, '.claude.json'));
  if (!profile) return { models: [], deniedIds: [] };
  const models = new Map<string, ClaudeCatalogModel>();
  const denied = new Set<string>();
  const add = (value: unknown, label?: unknown, runtime?: Record<string, unknown>) => {
    const id = claudeModelId(value);
    if (!id || denied.has(id)) return;
    const rawName = typeof label === 'string' ? label.trim() : '';
    const name = rawName && /\d/.test(rawName) ? (/^Claude\b/i.test(rawName) ? rawName : `Claude ${rawName}`) : id;
    const context = runtime?.max_input_tokens;
    models.set(id, {
      id, name,
      contextWindow: typeof context === 'number' && Number.isFinite(context) && context > 0 ? context : undefined,
      capabilities: ['chat', ...(Array.isArray(runtime?.capabilities) && runtime.capabilities.includes('mm_images') ? ['vision'] : [])],
    });
  };
  for (const value of Array.isArray(profile.modelAccessCache) ? profile.modelAccessCache : []) {
    const access = object(value);
    const id = claudeModelId(access.apiName);
    if (id && access.entitled === false) denied.add(id);
  }
  for (const value of Array.isArray(profile.additionalModelOptionsCache) ? profile.additionalModelOptionsCache : []) {
    const option = object(value);
    if (!option.disabled) add(option.value, option.label);
  }
  for (const value of Array.isArray(profile.modelAccessCache) ? profile.modelAccessCache : []) {
    const access = object(value);
    if (access.entitled === true) add(access.apiName);
  }
  const org = object(profile.oauthAccount).organizationUuid;
  const account = object(profile.oauthAccount).accountUuid;
  if (typeof org === 'string' && /^[a-zA-Z0-9-]+$/.test(org) && typeof account === 'string' && account) {
    const hash = createHash('sha256').update(account).digest('hex').slice(0, 12);
    const catalog = readJson(path.join(configDir, 'cache', 'model-catalog', `${org}-${hash}-cc.json`));
    const surface = object(catalog?.catalog);
    const entries = object(surface.config).models;
    if (catalog?.version === 2 && surface.surface === 'cc' && Array.isArray(entries)) {
      for (const value of entries) {
        const model = object(value);
        add(model.id, model.name, object(model.runtime));
      }
    }
  }
  const priced = Array.from(models.values()).map((model) => {
    const pricing = claudeAccountPricing(profile.additionalModelCostsCache, model.id);
    return pricing ? { ...model, pricing } : model;
  });
  return { models: priced, deniedIds: Array.from(denied) };
}
