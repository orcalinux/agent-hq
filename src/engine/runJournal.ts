import { runJournalApi } from '@/api/client';
import { reconcileInterrupted } from '@/engine/runRecovery';
import { useAgentStore } from '@/store/useAgentStore';
import type { MissionState } from '@/types';

/** Only an unfinished live run is worth bringing back; finished or dismissed runs stay gone. */
export function restorableFromJournal(mission: unknown): MissionState | null {
  const candidate = mission as MissionState | null;
  if (!candidate || candidate.source !== 'live' || !Array.isArray(candidate.tasks)) return null;
  const unfinished = candidate.status === 'running' || (candidate.status === 'paused' && !!candidate.providerLimit)
    || (candidate.status === 'cancelled' && candidate.interrupted === true);
  return unfinished ? reconcileInterrupted(candidate) : null;
}

/** If browser storage lost the active run (cleared data, new profile), bring it back from the server's journal. */
export async function restoreFromJournal(): Promise<boolean> {
  if (useAgentStore.getState().activeMission) return false;
  try {
    const { journal } = await runJournalApi.load();
    const mission = restorableFromJournal(journal?.mission);
    if (!mission || useAgentStore.getState().activeMission) return false;
    useAgentStore.setState({ activeMission: mission });
    return true;
  } catch {
    return false;
  }
}

let started = false;

/** Mirrors the live run into the server's journal (throttled) and clears it when the run is dismissed. */
export function startRunJournal(): void {
  if (started) return;
  started = true;
  let timer: number | undefined;
  let last: MissionState | null = useAgentStore.getState().activeMission;
  useAgentStore.subscribe((state) => {
    const mission = state.activeMission;
    if (mission === last) return;
    const dismissed = last !== null && mission === null;
    last = mission;
    window.clearTimeout(timer);
    if (dismissed) {
      void runJournalApi.clear().catch(() => undefined);
      return;
    }
    if (!mission || mission.source !== 'live') return;
    timer = window.setTimeout(() => void runJournalApi.save(mission).catch(() => undefined), 800);
  });
}
