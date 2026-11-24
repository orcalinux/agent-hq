import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/client', () => ({
  streamChat: vi.fn(async () => { throw new Error('No model call should be made when verification is unavailable.'); }),
  api: new Proxy({}, { get: () => async () => ({ tools: [], content: '' }) }),
  ApiError: class ApiError extends Error {},
}));

const { streamChat } = await import('@/api/client');
const { useAgentStore } = await import('@/store/useAgentStore');
const { useWorkspaceStore } = await import('@/store/useWorkspaceStore');
const { executeRun } = await import('@/engine/liveOrchestrator');

describe('unavailable verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAgentStore.setState({
      approvalMode: 'auto',
      verificationCommand: 'python -m pytest -q',
      learningMode: 'off',
      runHistory: [],
      activity: [],
      runLimits: { maxCostUSD: null, maxTokens: null, maxMinutes: null, maxCallsPerAgent: null, maxCostPerAgentUSD: null },
      activeMission: {
        id: 'verify-gate', title: 'Verify', source: 'live', status: 'running',
        startedAt: Date.now(), currentStage: 'implementation', stageIndex: 2,
        tasks: [{
          id: 'qa-review', title: 'QA', stage: 'qa_review', assignedAgentId: 'agent-qa',
          status: 'pending', priority: 'medium', progress: 0, tags: [], dependsOn: [],
        }],
        proposedChanges: [],
      } as never,
    });
  });

  it('stops before model calls when pytest is missing and leaves QA pending for resume', async () => {
    useWorkspaceStore.setState({ runCommand: vi.fn(async () => ({
      exitCode: 1, stdout: '', stderr: '/usr/bin/python: No module named pytest',
    })) } as never);
    await executeRun();
    const mission = useAgentStore.getState().activeMission!;
    expect(mission.status).toBe('failed');
    expect(mission.error).toContain('Verification "python -m pytest -q" is unavailable');
    expect(mission.error).toContain('Resume');
    expect(mission.tasks[0].status).toBe('pending');
    expect(mission.qaCertificate).toBeUndefined();
    expect(streamChat).not.toHaveBeenCalled();
  });

  it('does not certify a candidate if the runner disappears after preflight', async () => {
    const runCommand = vi.fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: '1 passed', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 127, stdout: '', stderr: 'python: command not found' });
    useWorkspaceStore.setState({ runCommand } as never);
    await executeRun();
    const mission = useAgentStore.getState().activeMission!;
    expect(runCommand).toHaveBeenCalledTimes(2);
    expect(mission.status).toBe('failed');
    expect(mission.error).toContain('could not run');
    expect(mission.tasks[0].status).toBe('pending');
    expect(mission.qaCertificate).toBeUndefined();
    expect(streamChat).not.toHaveBeenCalled();
  });

  it('reports a rejected command before any implementation', async () => {
    useWorkspaceStore.setState({ runCommand: vi.fn(async () => ({
      rejected: true, exitCode: null, stdout: '', stderr: 'Command is not allowed',
    })) } as never);
    await executeRun();
    expect(useAgentStore.getState().activeMission?.error).toContain('Command is not allowed');
    expect(streamChat).not.toHaveBeenCalled();
  });
});
