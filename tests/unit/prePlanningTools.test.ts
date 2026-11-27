import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseProjectRequest } from '@/engine/projectTools';

let chatTurn = 0;

vi.mock('@/api/client', () => ({
  streamChat: vi.fn(async (req: { onDelta?: (chunk: string, full: string) => void; signal?: AbortSignal }) => {
    if (req.signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
    chatTurn += 1;
    if (chatTurn === 1) {
      const callText = '```project-call\n{"name":"read_files","paths":["src/cli.py"],"startLine":1,"lineCount":20}\n```';
      req.onDelta?.(callText, callText);
      return {
        text: callText,
        usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
      };
    }
    const finalPlan = 'Here is the grounded plan.';
    req.onDelta?.(finalPlan, finalPlan);
    return {
      text: finalPlan,
      usage: { inputTokens: 250, outputTokens: 40, totalTokens: 290 },
    };
  }),
  api: new Proxy(
    {},
    {
      get: (_target, prop) => async (path?: string) => {
        if (prop === 'readFile') {
          return { content: `def main():\n    # from ${path}\n    return 0\n` };
        }
        return { tools: [], content: '' };
      },
    }
  ),
  ApiError: class ApiError extends Error {},
}));

const { useAgentStore } = await import('@/store/useAgentStore');
const { useWorkspaceStore } = await import('@/store/useWorkspaceStore');
const { useConnectionsStore } = await import('@/store/useConnectionsStore');
const { projectToolReply, sendToOrchestrator } = await import('@/engine/liveOrchestrator');

describe('pre-planning project inspection', () => {
  beforeEach(() => {
    chatTurn = 0;
    vi.clearAllMocks();
    const roleDefaults = Object.fromEntries(Object.keys(useAgentStore.getState().roleDefaults).map((r) => [r, 'test:model'])) as never;
    useConnectionsStore.setState({
      providers: [{ id: 'test', name: 'Test', kind: 'openai', connected: true, status: 'connected', models: [{ id: 'test:model', name: 'Test Model', ref: 'test:model' }] } as never],
      exhausted: {} as never,
    });
    useWorkspaceStore.setState({
      projectName: 'sample-app',
      tree: [{ name: 'cli.py', path: 'src/cli.py', type: 'file' }],
      buffers: {},
    } as never);
    useAgentStore.setState({
      roleDefaults,
      activeMission: null,
      liveRunning: false,
      managerChatMessages: [],
      learningMode: 'off',
      orchestratorMode: 'plan',
      modelScope: 'all',
      forceSetup: false,
      complexityRouting: false,
    } as never);
  });

  it('projectToolReply reads workspace files even when no mission is active', async () => {
    const parsed = parseProjectRequest('```project-call\n{"name":"read_files","paths":["src/cli.py"],"startLine":1,"lineCount":5}\n```');
    expect(parsed).not.toBeNull();
    const reply = await projectToolReply(parsed!);
    expect(reply).toContain('def main():');
    expect(reply).toContain('# from src/cli.py');
  });

  it('sendToOrchestrator executes bounded project-call rounds in plan mode and sums usage', async () => {
    await sendToOrchestrator('Plan CLI updates', []);
    const chat = useAgentStore.getState().managerChatMessages;
    const reply = chat.filter((m) => m.sender === 'manager').at(-1);
    expect(chatTurn).toBe(2);
    expect(reply?.text).toBe('Here is the grounded plan.');
    expect(reply?.usage?.inputTokens).toBe(350);
    expect(reply?.usage?.outputTokens).toBe(60);
    expect(reply?.usage?.totalTokens).toBe(410);
  });
});
