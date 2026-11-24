import type { ApprovalMode, MissionState } from '@/types';

export const INTERRUPTED_MESSAGE = 'Interrupted: Agent HQ closed or reloaded during the run. Finished tasks are kept; Resume continues the rest.';
export const DESKTOP_INTERRUPTED = 'Interrupted after desktop actions. They may have taken effect; check the app, then Retry this task.';

/**
 * The saved form of a run that was still going when the app stopped. Finished tasks keep their output; tasks that
 * were mid-flight go back to pending so Resume redoes only them, unless they already acted on the desktop: those
 * fail with a note, because replaying a click or keystroke can do it twice. Runs that already ended are saved unchanged.
 */
export function reconcileInterrupted(mission: MissionState): MissionState {
  if (mission.source !== 'live' || mission.status !== 'running') return mission;
  return {
    ...mission,
    status: 'cancelled',
    error: INTERRUPTED_MESSAGE,
    interrupted: true,
    tasks: mission.tasks.map((t) => {
      if (t.status !== 'in_progress' && t.status !== 'review') return t;
      if (t.computerActions) return { ...t, status: 'failed', progress: 0, error: DESKTOP_INTERRUPTED, computerNeedsReview: true };
      return { ...t, status: 'pending', progress: 0, error: undefined };
    }),
  };
}

/** In Full access an interrupted run picks up again on its own, unless a task stopped mid-way through desktop actions. */
export function shouldAutoResume(mission: MissionState | null, mode: ApprovalMode, running: boolean): boolean {
  return !!mission && mission.source === 'live' && !!mission.interrupted && mission.status === 'cancelled' && mode === 'full' && !running
    && !mission.tasks.some((t) => t.computerNeedsReview || t.error === DESKTOP_INTERRUPTED);
}
