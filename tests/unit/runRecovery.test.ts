import { describe, expect, it } from 'vitest';
import { DESKTOP_INTERRUPTED, INTERRUPTED_MESSAGE, reconcileInterrupted, shouldAutoResume } from '@/engine/runRecovery';
import { useAgentStore } from '@/store/useAgentStore';
import type { MissionState } from '@/types';

const task = (id: string, status: string, output?: string) => ({ id, title: id, description: '', stage: 'implementation', assignedAgentId: 'agent-frontend', status, priority: 'medium', progress: status === 'completed' ? 100 : 40, tags: [], dependsOn: [], output });

const running = (): MissionState =>
  ({
    id: 'run-1', title: 'Run', source: 'live', status: 'running', startedAt: 1, currentStage: 'implementation', stageIndex: 2,
    tasks: [task('done', 'completed', 'kept output'), task('mid', 'in_progress'), task('rev', 'review'), task('todo', 'pending')],
  }) as never;

describe('interrupted runs', () => {
  it('keep finished work and put mid-flight tasks back to pending', () => {
    const saved = reconcileInterrupted(running());
    expect(saved).toMatchObject({ status: 'cancelled', interrupted: true, error: INTERRUPTED_MESSAGE });
    expect(saved.tasks.map((t) => t.status)).toEqual(['completed', 'pending', 'pending', 'pending']);
    expect(saved.tasks[0].output).toBe('kept output');
  });

  it('leave runs that already ended untouched', () => {
    const done = { ...running(), status: 'completed' } as MissionState;
    expect(reconcileInterrupted(done)).toBe(done);
  });

  it('fail a task that already acted on the desktop and stop Full access from resuming', () => {
    const mission = running();
    mission.tasks[1] = { ...mission.tasks[1], computerActions: 2, computerLog: ['click s00000001:1', 'type_text s00000001:0 (5 characters)'] };
    const saved = reconcileInterrupted(mission);
    expect(saved.tasks[1]).toMatchObject({ status: 'failed', error: DESKTOP_INTERRUPTED, computerActions: 2 });
    expect(saved.tasks[2].status).toBe('pending');
    expect(shouldAutoResume(saved, 'full', false)).toBe(false);
  });

  it('are reconciled by the store when it saves', () => {
    useAgentStore.setState({ activeMission: running() });
    const persisted = useAgentStore.persist.getOptions().partialize!(useAgentStore.getState()) as { activeMission: MissionState };
    expect(persisted.activeMission.interrupted).toBe(true);
    expect(persisted.activeMission.tasks.find((t) => t.id === 'mid')!.status).toBe('pending');
  });

  it('resume by themselves only in Full access and only when nothing is running', () => {
    const saved = reconcileInterrupted(running());
    expect(shouldAutoResume(saved, 'full', false)).toBe(true);
    expect(shouldAutoResume(saved, 'auto', false)).toBe(false);
    expect(shouldAutoResume(saved, 'ask', false)).toBe(false);
    expect(shouldAutoResume(saved, 'full', true)).toBe(false);
    expect(shouldAutoResume({ ...saved, interrupted: undefined }, 'full', false)).toBe(false);
    expect(shouldAutoResume(null, 'full', false)).toBe(false);
  });
});
