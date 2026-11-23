/**
 * Spending, time and loop limits for one run. A limit of null is off. Tokens from models with unknown pricing
 * count against the token limit like any other tokens, so an unpriced model is never treated as free.
 */
export interface RunLimits {
  maxCostUSD: number | null;
  maxTokens: number | null;
  maxMinutes: number | null;
  maxCallsPerAgent: number | null;
}

export const DEFAULT_RUN_LIMITS: RunLimits = { maxCostUSD: 10, maxTokens: 5_000_000, maxMinutes: 90, maxCallsPerAgent: 60 };

export const WARN_RATIO = 0.8;

export interface RunUsage {
  costUSD: number;
  tokens: number;
  elapsedMs: number;
  callsByAgent: Record<string, number>;
}

export type LimitKind = 'cost' | 'tokens' | 'time' | 'calls';

export interface LimitReading {
  kind: LimitKind;
  used: number;
  limit: number;
  ratio: number;
  agentId?: string;
}

export interface LimitCheck {
  stop: LimitReading | null;
  warnings: LimitReading[];
}

export function normalizeLimit(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

export function normalizeLimits(value: Partial<RunLimits> | undefined): RunLimits {
  const v = value ?? {};
  return {
    maxCostUSD: 'maxCostUSD' in v ? normalizeLimit(v.maxCostUSD) : DEFAULT_RUN_LIMITS.maxCostUSD,
    maxTokens: 'maxTokens' in v ? normalizeLimit(v.maxTokens) : DEFAULT_RUN_LIMITS.maxTokens,
    maxMinutes: 'maxMinutes' in v ? normalizeLimit(v.maxMinutes) : DEFAULT_RUN_LIMITS.maxMinutes,
    maxCallsPerAgent: 'maxCallsPerAgent' in v ? normalizeLimit(v.maxCallsPerAgent) : DEFAULT_RUN_LIMITS.maxCallsPerAgent,
  };
}

export function readLimits(limits: RunLimits, usage: RunUsage): LimitReading[] {
  const out: LimitReading[] = [];
  const push = (kind: LimitKind, used: number, limit: number | null, agentId?: string) => {
    if (limit !== null) out.push({ kind, used, limit, ratio: used / limit, agentId });
  };
  push('cost', usage.costUSD, limits.maxCostUSD);
  push('tokens', usage.tokens, limits.maxTokens);
  push('time', usage.elapsedMs / 60_000, limits.maxMinutes);
  if (limits.maxCallsPerAgent !== null) {
    let busiest: [string, number] | null = null;
    for (const entry of Object.entries(usage.callsByAgent)) if (!busiest || entry[1] > busiest[1]) busiest = entry;
    if (busiest) push('calls', busiest[1], limits.maxCallsPerAgent, busiest[0]);
  }
  return out;
}

/** `stop` is set once any limit is reached; `warnings` lists limits at or above 80% that are not yet reached. */
export function checkLimits(limits: RunLimits, usage: RunUsage): LimitCheck {
  const readings = readLimits(limits, usage);
  const stop = readings.find((r) => r.ratio >= 1) ?? null;
  return { stop, warnings: readings.filter((r) => r.ratio >= WARN_RATIO && r.ratio < 1) };
}

export function describeLimit(r: LimitReading, agentName?: string): string {
  switch (r.kind) {
    case 'cost':
      return `cost $${r.used.toFixed(2)} of the $${r.limit.toFixed(2)} limit`;
    case 'tokens':
      return `${Math.round(r.used).toLocaleString('en-US')} of the ${Math.round(r.limit).toLocaleString('en-US')} token limit`;
    case 'time':
      return `${Math.floor(r.used)} of the ${Math.round(r.limit)} minute limit`;
    case 'calls':
      return `${agentName ?? r.agentId ?? 'an agent'} made ${r.used} of the ${r.limit} model calls allowed per agent (loop guard)`;
  }
}
