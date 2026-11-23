import { describe, expect, it, vi } from 'vitest';

vi.mock('@/api/client', () => ({
  streamChat: vi.fn(async (req: { system: string }) => ({
    text: '```ts path=src/shared.ts\nexport const owner = ' + JSON.stringify(req.system.slice(0, 12)) + ';\n```\n```ts path=src/only-mine-' + Math.random().toString(36).slice(2, 6) + '.ts\nexport {};\n```',
    usage: { inputTokens: 10, outputTokens: 10 },
  })),
  api: new Proxy({}, { get: () => async () => ({ exists: false, content: '' }) }),
  ApiError: class ApiError extends Error {},
}));

const { useAgentStore } = await import('@/store/useAgentStore');
const { useWorkspaceStore } = await import('@/store/useWorkspaceStore');
const { executeRun, autoApplyChanges } = await import('@/engine/liveOrchestrator');

describe('parallel edits of the same file in a run', () => {
  it('are reported as a conflict and never auto-applied, while other files still are', async () => {
    const roleDefaults = Object.fromEntries(Object.keys(useAgentStore.getState().roleDefaults).map((r) => [r, 'test:model'])) as never;
    const task = (id: string, agentId: string) => ({ id, title: `Task ${id}`, description: 'Edit.', stage: 'implementation', assignedAgentId: agentId, status: 'pending', priority: 'medium', progress: 0, tags: [], dependsOn: [] });
    useAgentStore.setState({
      roleDefaults,
      maxParallel: 2,
      activity: [],
      activeMission: {
        id: 'run-conflict', title: 'Conflict', source: 'live', status: 'running', startedAt: Date.now(), currentStage: 'implementation', stageIndex: 2,
        tasks: [task('ui', 'agent-frontend'), task('api', 'agent-backend'), { ...task('qa-review', 'agent-qa'), dependsOn: ['ui', 'api'], stage: 'qa_review' }],
      } as never,
    });
    await executeRun();

    const proposals = useAgentStore.getState().activeMission!.proposedChanges!;
    const shared = proposals.filter((p) => p.path === 'src/shared.ts');
    expect(shared.map((p) => p.conflictsWith)).toEqual([['api'], ['ui']]);
    expect(useAgentStore.getState().activity.some((a) => a.text.startsWith('Conflict:') && a.text.includes('src/shared.ts'))).toBe(true);

    const written: string[] = [];
    useWorkspaceStore.setState({ writeAndReload: async (path: string) => void written.push(path) } as never);
    const result = await autoApplyChanges();
    expect(written).not.toContain('src/shared.ts');
    expect(written.length).toBe(2);
    expect(result).toEqual({ applied: 2, failed: 0 });
    expect(useAgentStore.getState().activeMission!.proposedChanges!.filter((p) => p.path === 'src/shared.ts').every((p) => p.status === 'pending')).toBe(true);
  });
});
