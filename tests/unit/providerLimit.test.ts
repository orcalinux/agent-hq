import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isQuotaError, quotaResetAt } from '@/engine/failover';

vi.mock('@/api/client', () => ({
  streamChat: vi.fn(),
  api: new Proxy({}, { get: () => async () => ({ tools: [], content: '', lessons: [] }) }),
  ApiError: class ApiError extends Error {},
}));

const { streamChat } = await import('@/api/client');
const { useAgentStore } = await import('@/store/useAgentStore');
const { useConnectionsStore } = await import('@/store/useConnectionsStore');
const { useWorkspaceStore } = await import('@/store/useWorkspaceStore');
const { executeRun, resumeRun } = await import('@/engine/liveOrchestrator');

describe('provider reset times', () => {
  const now = Date.parse('2026-11-24T14:00:00Z');
  it('recognizes actual Claude and Codex limit messages', () => {
    expect(isQuotaError("You've hit your 5-hour limit · resets 11:50am (America/New_York)")).toBe(true);
    expect(isQuotaError('You’ve hit your usage limit. Try again at 11:58 AM.')).toBe(true);
    expect(isQuotaError('HTTP 500: usage_limit_reached')).toBe(true);
    expect(isQuotaError('File size limit exceeded')).toBe(false);
  });
  it('reads relative reset times and named time zones independently of the machine zone', () => {
    expect(quotaResetAt('resets in 2h 15m', now)).toBe(now + 8_100_000);
    expect(quotaResetAt('retry after 30 seconds', now)).toBe(now + 30_000);
    expect(quotaResetAt('resets 11:50am (America/New_York)', now)).toBe(Date.parse('2026-11-24T16:50:00Z'));
    expect(quotaResetAt('resets 8am (America/New_York)', now)).toBe(Date.parse('2026-11-25T13:00:00Z'));
    expect(quotaResetAt('resets 12am (UTC)', now)).toBe(Date.parse('2026-11-25T00:00:00Z'));
    expect(quotaResetAt('resets 12pm (UTC)', now)).toBe(Date.parse('2026-11-25T12:00:00Z'));
  });
  it('reads a local Codex clock time and rejects unknown or malformed reset times', () => {
    const local = new Date(2026, 10, 24, 9, 0);
    expect(quotaResetAt('try again at 11:58 AM.', local.getTime())).toBe(new Date(2026, 10, 24, 11, 58).getTime());
    for (const message of ['429', 'resets later', 'resets 25:00 (UTC)', 'resets 11:99am (UTC)', 'resets 8am (bad/zone)']) {
      expect(quotaResetAt(message, now)).toBeNull();
    }
  });
});

describe('pausing at provider limits', () => {
  const initialAgents = useAgentStore.getState().agents;
  beforeEach(() => {
    vi.resetAllMocks();
    useConnectionsStore.setState({ providers: [], exhausted: {} });
    useWorkspaceStore.setState({ tree: [], root: '/tmp/limit-test' } as never);
    useAgentStore.setState({
      agents: Object.fromEntries(Object.entries(structuredClone(initialAgents)).map(([id, agent]) => [id, { ...agent, model: 'anthropic:cli:claude-haiku-5-5' }])),
      approvalMode: 'ask', verificationCommand: '', learningMode: 'every-run',
      runHistory: [], activity: [], managerChatMessages: [], maxParallel: 1, isLiveRunning: false,
      runLimits: { maxCostUSD: null, maxTokens: null, maxMinutes: null, maxCallsPerAgent: null, maxCostPerAgentUSD: null },
      activeMission: {
        id: 'quota-test', title: 'Quota recovery', prompt: 'Review the requirements.', source: 'live', status: 'running',
        startedAt: Date.now(), currentStage: 'implementation', stageIndex: 2, proposedChanges: [],
        tasks: [
          { id: 'done', title: 'Completed work', description: '', stage: 'implementation', assignedAgentId: 'agent-architect', status: 'completed', progress: 100, output: 'Keep this output', tags: [], dependsOn: [] },
          { id: 'work', title: 'Review requirements', description: 'Provide analysis only.', stage: 'implementation', assignedAgentId: 'agent-backend', model: 'anthropic:cli:claude-haiku-5-5', status: 'pending', progress: 0, tags: [], dependsOn: ['done'] },
          { id: 'dependent', title: 'Dependent review', description: 'Provide analysis only.', stage: 'implementation', assignedAgentId: 'agent-frontend', model: 'anthropic:cli:claude-haiku-5-5', status: 'pending', progress: 0, tags: [], dependsOn: ['work'] },
          { id: 'qa-review', title: 'QA', description: '', stage: 'qa_review', assignedAgentId: 'agent-qa', model: 'anthropic:cli:claude-haiku-5-5', status: 'pending', progress: 0, tags: [], dependsOn: ['dependent'] },
        ],
      } as never,
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('makes one call, pauses without failing dependents or reflecting, and refuses early resume', async () => {
    vi.mocked(streamChat).mockRejectedValue(new Error("You've hit your 5-hour limit · resets in 2h"));
    await executeRun();
    const state = useAgentStore.getState();
    expect(state.activeMission?.status).toBe('paused');
    expect(state.isLiveRunning).toBe(false);
    expect(state.activeMission?.error).toContain('Resets');
    expect(state.activeMission?.tasks.map((task) => task.status)).toEqual(['completed', 'pending', 'pending', 'pending']);
    expect(state.activeMission?.tasks[0].output).toBe('Keep this output');
    expect(state.activeMission?.completedAt).toBeUndefined();
    expect(state.activeMission?.qaRejectCount).toBeUndefined();
    expect(state.activeMission?.verifyLoopCount).toBeUndefined();
    expect(state.runHistory[0]).toMatchObject({ status: 'paused', tasksFailed: 0, tasksCompleted: 1 });
    expect(streamChat).toHaveBeenCalledTimes(1);
    await resumeRun();
    expect(streamChat).toHaveBeenCalledTimes(1);
    expect(useAgentStore.getState().activeMission?.status).toBe('paused');
  });

  it.each(['reset', 'explicit retry'])('resumes only unfinished tasks after %s and clears the pause', async (reason) => {
    vi.mocked(streamChat).mockRejectedValueOnce(new Error('usage limit reached; resets in 1m'));
    await executeRun();
    if (reason === 'reset') {
      useConnectionsStore.setState({ exhausted: { anthropic: Date.now() - 1 } });
      useAgentStore.getState().updateMission({ providerLimit: { provider: 'anthropic', resetAt: Date.now() - 1, resetKnown: true } });
    } else {
      useConnectionsStore.getState().clearExhausted('anthropic');
    }
    useAgentStore.setState({ learningMode: 'off' });
    vi.mocked(streamChat)
      .mockResolvedValueOnce({ text: '```python path=src/review.py\nreviewed = True\n```', latencyMs: 1 })
      .mockResolvedValueOnce({ text: '```python path=src/dependent.py\nreviewed = True\n```', latencyMs: 1 })
      .mockResolvedValueOnce({ text: '{"verdict":"approve","summary":"Reviewed","issues":[]}', latencyMs: 1 });
    await resumeRun();
    expect(useAgentStore.getState().activeMission?.status, JSON.stringify(useAgentStore.getState().activeMission?.tasks.map((task) => ({ id: task.id, error: task.error })))).toBe('completed');
    expect(useAgentStore.getState().activeMission?.providerLimit).toBeUndefined();
    expect(useAgentStore.getState().activeMission?.tasks[0].output).toBe('Keep this output');
    expect(streamChat).toHaveBeenCalledTimes(4);
  });

  it('returns QA to pending if the limit occurs during review', async () => {
    const mission = useAgentStore.getState().activeMission!;
    useAgentStore.getState().updateMission({ tasks: mission.tasks.map((task) => task.id === 'qa-review' ? task : { ...task, status: 'completed', progress: 100 }) });
    vi.mocked(streamChat).mockRejectedValue(new Error('429 Too Many Requests'));
    await executeRun();
    expect(useAgentStore.getState().activeMission?.status, useAgentStore.getState().activeMission?.error).toBe('paused');
    expect(useAgentStore.getState().activeMission?.tasks.at(-1)?.status).toBe('pending');
    expect(useAgentStore.getState().activeMission?.providerLimit?.resetKnown).toBe(false);
    expect(streamChat).toHaveBeenCalledTimes(1);
  });

  it('aborts other calls already in flight and leaves their tasks pending', async () => {
    const mission = useAgentStore.getState().activeMission!;
    useAgentStore.setState({ maxParallel: 3 });
    useAgentStore.getState().updateMission({ tasks: mission.tasks.map((task) => task.id === 'dependent' ? { ...task, dependsOn: ['done'] } : task) });
    vi.mocked(streamChat).mockImplementation(async (request) => {
      if (request.messages[0].content.includes('Your task: Review requirements')) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        throw new Error('usage limit reached; resets in 1h');
      }
      return new Promise((_resolve, reject) => {
        const abort = () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
        if (request.signal?.aborted) abort();
        else request.signal?.addEventListener('abort', abort, { once: true });
      });
    });
    await executeRun();
    expect(useAgentStore.getState().activeMission?.status).toBe('paused');
    expect(useAgentStore.getState().activeMission?.tasks.map((task) => task.status)).toEqual(['completed', 'pending', 'pending', 'pending']);
    expect(streamChat).toHaveBeenCalledTimes(2);
  });

  it('does not call an exhausted provider again when execution is invoked directly', async () => {
    useConnectionsStore.setState({ exhausted: { anthropic: Date.now() + 60_000 } });
    await executeRun();
    expect(useAgentStore.getState().activeMission?.status).toBe('paused');
    expect(useAgentStore.getState().activeMission?.tasks.filter((task) => task.status === 'failed')).toHaveLength(0);
    expect(streamChat).not.toHaveBeenCalled();
  });
});
