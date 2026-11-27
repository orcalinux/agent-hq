import type { RunRecord } from '../types';
import { normalizeLimit, WARN_RATIO } from './runLimits';

export interface BudgetPolicy {
  monthlyCostUSD: number | null;
  monthlyTokens: number | null;
  autoResumeOnQuotaReset: boolean;
}

export const DEFAULT_BUDGET_POLICY: BudgetPolicy = {
  monthlyCostUSD: null,
  monthlyTokens: null,
  autoResumeOnQuotaReset: false,
};

export type BudgetKind = 'monthlyCost' | 'monthlyTokens';

export interface MonthlyUsage {
  monthKey: string;
  costUSD: number;
  tokens: number;
  runsCount: number;
}

export interface BudgetReading {
  kind: BudgetKind;
  used: number;
  limit: number;
  ratio: number;
}

export interface BudgetCheck {
  stop: BudgetReading | null;
  warnings: BudgetReading[];
}

export function monthKeyOf(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function normalizeBudgetPolicy(value: Partial<BudgetPolicy> | undefined): BudgetPolicy {
  const v = value ?? {};
  return {
    monthlyCostUSD: 'monthlyCostUSD' in v ? normalizeLimit(v.monthlyCostUSD) : DEFAULT_BUDGET_POLICY.monthlyCostUSD,
    monthlyTokens: 'monthlyTokens' in v ? normalizeLimit(v.monthlyTokens) : DEFAULT_BUDGET_POLICY.monthlyTokens,
    autoResumeOnQuotaReset: Boolean(v.autoResumeOnQuotaReset),
  };
}

/** Sums recorded cost and tokens for the current local calendar month, avoiding double counting an active run already in runHistory. */
export function computeMonthlyUsage(
  runHistory: RunRecord[],
  activeRun?: { id?: string; costUSD: number; tokens: number },
  now = Date.now(),
): MonthlyUsage {
  const key = monthKeyOf(now);
  let costUSD = 0;
  let tokens = 0;
  let runsCount = 0;
  for (const r of runHistory) {
    if (monthKeyOf(r.startedAt) !== key) continue;
    if (activeRun?.id && r.id === activeRun.id) continue;
    costUSD += Number.isFinite(r.costUSD) ? r.costUSD : 0;
    tokens += (Number.isFinite(r.promptTokens) ? r.promptTokens : 0) + (Number.isFinite(r.completionTokens) ? r.completionTokens : 0);
    runsCount += 1;
  }
  if (activeRun) {
    costUSD += Number.isFinite(activeRun.costUSD) ? activeRun.costUSD : 0;
    tokens += Number.isFinite(activeRun.tokens) ? activeRun.tokens : 0;
    if (activeRun.id || activeRun.costUSD > 0 || activeRun.tokens > 0) runsCount += 1;
  }
  return { monthKey: key, costUSD, tokens, runsCount };
}

export function checkBudgetPolicy(policy: BudgetPolicy, usage: MonthlyUsage): BudgetCheck {
  const readings: BudgetReading[] = [];
  if (policy.monthlyCostUSD !== null) {
    readings.push({ kind: 'monthlyCost', used: usage.costUSD, limit: policy.monthlyCostUSD, ratio: usage.costUSD / policy.monthlyCostUSD });
  }
  if (policy.monthlyTokens !== null) {
    readings.push({ kind: 'monthlyTokens', used: usage.tokens, limit: policy.monthlyTokens, ratio: usage.tokens / policy.monthlyTokens });
  }
  const stop = readings.find((r) => r.ratio >= 1) ?? null;
  return { stop, warnings: readings.filter((r) => r.ratio >= WARN_RATIO && r.ratio < 1) };
}

export function describeBudget(reading: BudgetReading): string {
  return reading.kind === 'monthlyCost'
    ? `monthly spend $${reading.used.toFixed(2)} of the $${reading.limit.toFixed(2)} budget`
    : `monthly usage ${Math.round(reading.used).toLocaleString('en-US')} of the ${Math.round(reading.limit).toLocaleString('en-US')} token budget`;
}
