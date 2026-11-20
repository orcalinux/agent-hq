import type { AgentProfile, ActivityEvent, MissionState, ProviderState, AIModelId } from '../types';
import type { DesktopStatus, TraySnapshot } from './types';

export function makeTraySnapshot(
  state: { agents: Record<string, AgentProfile>; activeMission: MissionState | null; activity: ActivityEvent[]; themeMode: string },
  workspace: { name: string; root: string },
  providers: ProviderState[],
  status: DesktopStatus,
  resolveModel: (agent: AgentProfile) => AIModelId,
  labelModel: (model: AIModelId) => string,
): TraySnapshot {
  const agents = Object.values(state.agents);
  const mission = state.activeMission;
  return {
    ...status,
    theme: state.themeMode === 'light' ? 'light' : 'dark',
    project: workspace.name,
    projectPath: workspace.root,
    totalAgents: agents.length,
    connectedProviders: providers.filter((provider) => provider.connection).length,
    totalProviders: providers.length,
    mission: mission ? {
      title: mission.title,
      completed: mission.tasks.filter((task) => task.status === 'completed').length,
      total: mission.tasks.length,
      failed: mission.tasks.filter((task) => task.status === 'failed').length,
      review: mission.proposedChanges?.filter((change) => change.status === 'pending').length ?? 0,
      source: mission.source,
    } : null,
    usage: agents.reduce((sum, agent) => ({
      calls: sum.calls + agent.tokenUsage.calls,
      totalTokens: sum.totalTokens + agent.tokenUsage.totalTokens,
      estimatedCostUSD: sum.estimatedCostUSD + agent.tokenUsage.estimatedCostUSD,
      unpricedTokens: sum.unpricedTokens + agent.tokenUsage.unpricedTokens,
    }), { calls: 0, totalTokens: 0, estimatedCostUSD: 0, unpricedTokens: 0 }),
    agents: agents.slice(0, 100).map((agent) => {
      const model = resolveModel(agent);
      return {
        id: agent.id,
        name: agent.name,
        title: agent.specialty || agent.title,
        avatar: agent.avatar,
        status: agent.status,
        model: model ? labelModel(model) : 'No model assigned',
        task: agent.currentTask,
      };
    }),
    activity: state.activity.slice(-8).reverse().map((event) => ({
      id: event.id,
      text: event.text.slice(0, 300),
      timestamp: event.timestamp,
      level: event.level,
      agent: event.agentId ? state.agents[event.agentId]?.name : undefined,
    })),
  };
}
