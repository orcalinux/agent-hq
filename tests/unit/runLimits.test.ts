import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkLimits, DEFAULT_RUN_LIMITS, normalizeLimits, type RunLimits } from '@/engine/runLimits';

const calls: string[] = [];

vi.mock('@/api/client', () => ({
  streamChat: vi.fn(async (req: { model: string; signal: AbortSignal }) => {
    if (req.signal.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
    calls.push(req.model);
    return { text: 'Done.', usage: { inputTokens: 600, outputTokens: 500, totalTokens: 1100 } };
  }),
  api: new Proxy({}, { get: () => async () => ({ content: '' }) }),
  ApiError: class ApiError extends Error {},
}));

const { useAgentStore } = await import('@/store/useAgentStore');
const { executeRun } = await import('@/engine/liveOrchestrator');

const usage = (over: Partial<{ costUSD: number; tokens: number; elapsedMs: number; callsByAgent: Record<string, number>; costByAgent: Record<string, number> }> = {}) => ({
  costUSD: 0,
  tokens: 0,
  elapsedMs: 0,
  callsByAgent: {},
  costByAgent: {},
  ...over,
});

describe('run limit checks', () => {
  const limits: RunLimits = { maxCostUSD: 10, maxTokens: 1000, maxMinutes: 30, maxCallsPerAgent: 5, maxCostPerAgentUSD: 2 };

  it('is quiet below 80%, warns from 80% and stops at 100%', () => {
    expect(checkLimits(limits, usage({ tokens: 799 }))).toEqual({ stop: null, warnings: [] });
    expect(checkLimits(limits, usage({ tokens: 800 })).warnings.map((w) => w.kind)).toEqual(['tokens']);
    expect(checkLimits(limits, usage({ tokens: 1000 })).stop?.kind).toBe('tokens');
    expect(checkLimits(limits, usage({ costUSD: 10 })).stop?.kind).toBe('cost');
    expect(checkLimits(limits, usage({ elapsedMs: 30 * 60_000 })).stop?.kind).toBe('time');
  });

  it('guards loops by the busiest agent', () => {
    const stop = checkLimits(limits, usage({ callsByAgent: { a: 2, b: 5 } })).stop;
    expect(stop).toMatchObject({ kind: 'calls', agentId: 'b', used: 5 });
  });

  it('stops when one agent spends its share, naming the agent, and warns from 80%', () => {
    expect(checkLimits(limits, usage({ costByAgent: { a: 1.59, b: 0.5 } }))).toEqual({ stop: null, warnings: [] });
    expect(checkLimits(limits, usage({ costByAgent: { a: 1.6 } })).warnings).toMatchObject([{ kind: 'agentCost', agentId: 'a' }]);
    expect(checkLimits(limits, usage({ costByAgent: { a: 0.4, b: 2 } })).stop).toMatchObject({ kind: 'agentCost', agentId: 'b', used: 2, limit: 2 });
    expect(checkLimits({ ...limits, maxCostPerAgentUSD: null }, usage({ costByAgent: { a: 999 } }))).toEqual({ stop: null, warnings: [] });
    expect(checkLimits(limits, usage())).toEqual({ stop: null, warnings: [] });
  });

  it('leaves the per-agent cost limit off by default and keeps saved settings from before it existed', () => {
    expect(DEFAULT_RUN_LIMITS.maxCostPerAgentUSD).toBeNull();
    expect(normalizeLimits({ maxCostUSD: 3, maxTokens: 10, maxMinutes: 5, maxCallsPerAgent: 7 } as Partial<RunLimits>).maxCostPerAgentUSD).toBeNull();
    expect(normalizeLimits({ maxCostPerAgentUSD: 4 }).maxCostPerAgentUSD).toBe(4);
  });

  it('treats empty, zero and invalid values as no limit, and keeps defaults for missing ones', () => {
    const off = normalizeLimits({ maxCostUSD: null, maxTokens: 0, maxMinutes: Number.NaN, maxCallsPerAgent: -3, maxCostPerAgentUSD: 0 });
    expect(off).toEqual({ maxCostUSD: null, maxTokens: null, maxMinutes: null, maxCallsPerAgent: null, maxCostPerAgentUSD: null });
    expect(checkLimits(off, usage({ tokens: 1e12, costUSD: 1e9 }))).toEqual({ stop: null, warnings: [] });
    expect(normalizeLimits(undefined)).toEqual(DEFAULT_RUN_LIMITS);
  });
});

describe('run limits in a live run', () => {
  beforeEach(() => {
    calls.length = 0;
    const roleDefaults = Object.fromEntries(Object.keys(useAgentStore.getState().roleDefaults).map((r) => [r, 'test:model'])) as never;
    const task = (id: string, agentId: string, dependsOn: string[] = []) => ({
      id, title: `Task ${id}`, description: 'Do it.', stage: 'implementation', assignedAgentId: agentId, status: 'pending', priority: 'medium', progress: 0, tags: [], dependsOn,
    });
    useAgentStore.setState({
      roleDefaults,
      maxParallel: 1,
      runLimits: { maxCostUSD: null, maxTokens: 2000, maxMinutes: null, maxCallsPerAgent: null, maxCostPerAgentUSD: null },
      activity: [],
      activeMission: {
        id: 'run-limit-test', title: 'Limit test', source: 'live', status: 'running', startedAt: Date.now(), currentStage: 'implementation', stageIndex: 2,
        tasks: [task('a', 'agent-frontend'), task('b', 'agent-backend', ['a']), task('c', 'agent-frontend', ['b']), { ...task('qa-review', 'agent-qa', ['a', 'b', 'c']), stage: 'qa_review' }],
      } as never,
    });
  });

  it('stops the run once the token limit is reached and leaves unfinished work pending for Resume', async () => {
    await executeRun();
    const mission = useAgentStore.getState().activeMission!;
    expect(calls.length).toBe(2);
    expect(mission.status).toBe('failed');
    expect(mission.error).toMatch(/Stopped by run limit: 2,200 of the 2,000 token limit/);
    expect(mission.tasks.find((t) => t.id === 'c')!.status).toBe('pending');
    const texts = useAgentStore.getState().activity.map((a) => a.text);
    expect(texts.some((t) => t.startsWith('Run limit at 55%'))).toBe(false);
    expect(texts.some((t) => t.startsWith('Run stopped: 2,200 of the 2,000 token limit'))).toBe(true);
  });

  it('stops the run when one agent reaches its cost limit, even though the whole-run cost is not reached', async () => {
    const { useConnectionsStore } = await import('@/store/useConnectionsStore');
    useConnectionsStore.setState({ userPricing: { 'test:model': { inputPerM: 1000, outputPerM: 1000 } } });
    useAgentStore.getState().setRunLimits({ maxTokens: null, maxCostUSD: 100, maxCostPerAgentUSD: 2 });
    await executeRun();
    const mission = useAgentStore.getState().activeMission!;
    expect(calls.length).toBe(3);
    expect(mission.status).toBe('failed');
    expect(mission.error).toMatch(/Stopped by run limit: Pulse spent \$2\.20 of the \$2\.00 allowed per agent/);
    expect(mission.tasks.find((t) => t.id === 'qa-review')!.status).toBe('pending');
    useConnectionsStore.setState({ userPricing: {} });
  });

  it('runs to the end when the limit is off', async () => {
    useAgentStore.getState().setRunLimits({ maxTokens: null });
    await executeRun();
    expect(calls.length).toBeGreaterThanOrEqual(4);
    expect(useAgentStore.getState().activeMission!.error ?? '').not.toMatch(/run limit/);
  });
});
