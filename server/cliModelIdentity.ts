import type { StoredConnection } from './config';
import { claudeModelId, readClaudeCatalog, type ClaudeCatalog } from './claudeCatalog';

export function reportedClaudeModels(result: { modelUsage?: unknown }): string[] {
  if (!result.modelUsage || typeof result.modelUsage !== 'object' || Array.isArray(result.modelUsage)) return [];
  return Object.keys(result.modelUsage).filter((id) => id.trim() === id && id.length > 0 && id.length <= 200);
}

export interface ClaudeCliUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_1h_input_tokens?: number; ephemeral_5m_input_tokens?: number };
}

const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0);

/** Claude reports cache reads and writes outside input_tokens; keep them so cost and totals are complete. */
export function claudeCliUsage(usage: ClaudeCliUsage) {
  const inputTokens = count(usage.input_tokens);
  const outputTokens = count(usage.output_tokens);
  const cacheReadTokens = count(usage.cache_read_input_tokens);
  const oneHour = count(usage.cache_creation?.ephemeral_1h_input_tokens);
  const cacheWriteTokens = Math.max(count(usage.cache_creation_input_tokens), oneHour + count(usage.cache_creation?.ephemeral_5m_input_tokens));
  return {
    inputTokens, outputTokens,
    totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
    ...(cacheReadTokens ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens ? { cacheWriteTokens } : {}),
    ...(oneHour ? { cacheWrite1hTokens: Math.min(oneHour, cacheWriteTokens) } : {}),
  };
}

export function observeCliModels(conn: StoredConnection, cwd: string, model: string, models: string[]): void {
  if (conn.method !== 'cli' || conn.providerId !== 'anthropic' || models.length === 0) return;
  const previous = conn.cliModelObservation?.cwd === cwd ? conn.cliModelObservation.models : {};
  conn.cliModelObservation = { cwd, models: { ...previous, [model.replace(/^cli:/, '')]: models } };
}

export function claudeModelChoices(conn: StoredConnection, cwd: string, catalog: ClaudeCatalog = readClaudeCatalog()) {
  const observed = conn.cliModelObservation?.cwd === cwd ? conn.cliModelObservation.models : {};
  const exact = new Map(catalog.models.map((model) => [model.id, model]));
  const denied = new Set(catalog.deniedIds);
  for (const models of Object.values(observed)) {
    for (const value of models) {
      const id = claudeModelId(value);
      if (id && !denied.has(id) && !exact.has(id)) exact.set(id, { id, name: id, capabilities: ['chat'] });
    }
  }
  return [
    ...Array.from(exact.values()).map((model) => ({ ...model, selectable: true, canonicalRef: undefined as string | undefined })),
    ...['default', 'sonnet', 'opus', 'haiku'].map((id) => {
      const reported = observed[id]?.map(claudeModelId).filter((value): value is string => Boolean(value));
      const target = reported?.length === 1 ? exact.get(reported[0]) : undefined;
      return {
        id,
        name: target?.name ?? (reported?.map((value) => exact.get(value)?.name ?? value).join(' + ') || 'Choose an exact model'),
        capabilities: ['chat'],
        contextWindow: target?.contextWindow,
        pricing: target?.pricing,
        selectable: false,
        canonicalRef: target ? `anthropic:cli:${target.id}` : undefined,
      };
    }),
  ];
}
