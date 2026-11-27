import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkBudgetPolicy, computeMonthlyUsage, DEFAULT_BUDGET_POLICY, describeBudget, normalizeBudgetPolicy } from '../../src/engine/budgets';
import { cancelQuotaAutoResume, scheduleQuotaAutoResume } from '../../src/engine/liveOrchestrator';
import { useAgentStore } from '../../src/store/useAgentStore';
import { useConnectionsStore } from '../../src/store/useConnectionsStore';
import type { MissionState, RunRecord } from '../../src/types';

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: 'run-1',
    title: 'Sample',
    source: 'live',
    status: 'completed',
    startedAt: new Date(2026, 10, 10, 12, 0, 0).getTime(),
    tasksTotal: 1,
    tasksCompleted: 1,
    tasksFailed: 0,
    promptTokens: 600,
    completionTokens: 400,
    costUSD: 2.5,
    unpricedTokens: 0,
    filesProposed: 1,
    filesApplied: 1,
    qaRejectCount: 0,
    ...overrides,
  };
}

describe('cross-run monthly budgets', () => {
  it('sums only runs in the current calendar month and avoids double-counting the active run', () => {
    const now = new Date(2026, 10, 26, 15, 0, 0).getTime();
    const prevMonth = new Date(2026, 9, 28, 12, 0, 0).getTime();
    const history: RunRecord[] = [
      makeRun({ id: 'old', startedAt: prevMonth, costUSD: 99, promptTokens: 90000, completionTokens: 10000 }),
      makeRun({ id: 'r1', startedAt: new Date(2026, 10, 5, 10, 0, 0).getTime(), costUSD: 3.0, promptTokens: 1500, completionTokens: 500 }),
      makeRun({ id: 'active-resumed', startedAt: now - 60_000, costUSD: 1.0, promptTokens: 200, completionTokens: 100 }),
    ];
    const usage = computeMonthlyUsage(history, { id: 'active-resumed', costUSD: 2.0, tokens: 800 }, now);
    expect(usage.monthKey).toBe('2026-11');
    expect(usage.costUSD).toBeCloseTo(5.0);
    expect(usage.tokens).toBe(2800);
    expect(usage.runsCount).toBe(2);
  });

  it('normalizes budget policy defaults with auto-resume disabled by default', () => {
    expect(DEFAULT_BUDGET_POLICY).toEqual({
      monthlyCostUSD: null,
      monthlyTokens: null,
      autoResumeOnQuotaReset: false,
    });
    expect(normalizeBudgetPolicy({ monthlyCostUSD: -5, monthlyTokens: 0, autoResumeOnQuotaReset: true })).toEqual({
      monthlyCostUSD: null,
      monthlyTokens: null,
      autoResumeOnQuotaReset: true,
    });
  });

  it('triggers warnings at 80% and stops at 100%', () => {
    const policy = { monthlyCostUSD: 10, monthlyTokens: 10_000, autoResumeOnQuotaReset: false };
    const warnCheck = checkBudgetPolicy(policy, { monthKey: '2026-11', costUSD: 8.5, tokens: 5000, runsCount: 1 });
    expect(warnCheck.stop).toBeNull();
    expect(warnCheck.warnings).toHaveLength(1);
    expect(describeBudget(warnCheck.warnings[0])).toContain('$8.50 of the $10.00 budget');

    const stopCheck = checkBudgetPolicy(policy, { monthKey: '2026-11', costUSD: 6, tokens: 10_000, runsCount: 2 });
    expect(stopCheck.stop?.kind).toBe('monthlyTokens');
    expect(describeBudget(stopCheck.stop!)).toContain('10,000');
  });
});

describe('quota auto-resume scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 26, 12, 0, 0));
  });

  afterEach(() => {
    cancelQuotaAutoResume();
    vi.useRealTimers();
    useAgentStore.setState({ activeMission: null, quotaAutoResumeAt: null, isLiveRunning: false });
    useConnectionsStore.getState().clearExhausted();
  });

  it('schedules and cancels auto-resume timers cleanly and clears provider exhaustion when reset arrives', async () => {
    const resetAt = Date.now() + 5_000;
    const pausedMission: MissionState = {
      id: 'run-paused',
      presetId: 'custom',
      source: 'live',
      title: 'Quota paused run',
      prompt: 'test',
      currentStage: 'implementation',
      stageIndex: 2,
      status: 'paused',
      providerLimit: { provider: 'openai', resetAt, resetKnown: true },
      startedAt: Date.now() - 10_000,
      stepIndex: 0,
      totalSteps: 1,
      tasks: [],
      mermaidDiagram: '',
    };
    useConnectionsStore.getState().markExhausted('openai', resetAt);
    useAgentStore.setState({ activeMission: pausedMission, isLiveRunning: false });

    scheduleQuotaAutoResume(resetAt);
    expect(useAgentStore.getState().quotaAutoResumeAt).toBe(resetAt);

    // Cancelling stops timer and clears scheduled timestamp
    cancelQuotaAutoResume();
    expect(useAgentStore.getState().quotaAutoResumeAt).toBeNull();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(useConnectionsStore.getState().exhausted.openai).toBe(resetAt);

    // Rescheduling executes cleanly when reset window arrives (note: setting activeMission null mid-callback keeps test offline without hitting /api/chat)
    scheduleQuotaAutoResume(Date.now() + 5_000);
    useAgentStore.setState({ activeMission: { ...pausedMission, tasks: [] } });
    // Intercept resume by clearing activeMission just before timer or verify exhausted cleared when timer runs with paused status
    await vi.advanceTimersByTimeAsync(5_000);
    expect(useAgentStore.getState().quotaAutoResumeAt).toBeNull();
    expect(useConnectionsStore.getState().exhausted.openai).toBeUndefined();
  });
});
