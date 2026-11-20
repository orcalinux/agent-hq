import type { AgentProfile, ActivityEvent, Lesson, MissionState, ProviderState, AIModelId } from '../types';
import { agentGrowth, weeklyLessons } from '../engine/growth';
import type { DesktopStatus, TraySnapshot } from './types';

function learningSummary(agents: AgentProfile[], lessons: Lesson[]): TraySnapshot['learning'] {
  const top = agents.map((agent) => agentGrowth(agent, lessons)).sort((a, b) => b.score - a.score)[0];
  const weekly = weeklyLessons(lessons);
  return {
    lessons: lessons.length,
    thisWeek: weekly[weekly.length - 1],
    ...(top && top.score > 0 ? { top: { name: top.agent.name, level: top.level.name } } : {}),
  };
}

export function makeTraySnapshot(
  state: { agents: Record<string, AgentProfile>; activeMission: MissionState | null; activity: ActivityEvent[]; themeMode: string },
  workspace: { name: string; root: string },
  providers: ProviderState[],
  status: DesktopStatus,
  resolveModel: (agent: AgentProfile) => AIModelId,
  labelModel: (model: AIModelId) => string,
  lessons?: Lesson[],
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
    ...(lessons ? { learning: learningSummary(agents, lessons) } : {}),
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
