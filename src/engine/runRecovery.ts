import type { ApprovalMode, MissionState } from '@/types';

export const INTERRUPTED_MESSAGE = 'Interrupted: Agent HQ closed or reloaded during the run. Finished tasks are kept; Resume continues the rest.';

/**
 * The saved form of a run that was still going when the app stopped. Finished tasks keep their output; tasks that
 * were mid-flight go back to pending so Resume redoes only them. Runs that already ended are saved unchanged.
 */
export function reconcileInterrupted(mission: MissionState): MissionState {
  if (mission.source !== 'live' || mission.status !== 'running') return mission;
  return {
    ...mission,
    status: 'cancelled',
    error: INTERRUPTED_MESSAGE,
    interrupted: true,
    tasks: mission.tasks.map((t) =>
      t.status === 'in_progress' || t.status === 'review' ? { ...t, status: 'pending', progress: 0, error: undefined } : t,
    ),
  };
}

/** In Full access an interrupted run picks up again on its own; otherwise the user presses Resume. */
export function shouldAutoResume(mission: MissionState | null, mode: ApprovalMode, running: boolean): boolean {
  return !!mission && mission.source === 'live' && !!mission.interrupted && mission.status === 'cancelled' && mode === 'full' && !running;
}
