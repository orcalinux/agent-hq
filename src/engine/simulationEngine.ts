import {
  SimulationEvent,
  SOP_STAGES,
  SOPStage,
} from '../types';
import { buildMissionPlan, BuiltMissionPlan } from './preloadedMissions';

export const SOP_STAGE_ORDER: SOPStage[] = SOP_STAGES.map((s) => s.id);

export function getSOPStageIndex(stage: SOPStage): number {
  const idx = SOP_STAGE_ORDER.indexOf(stage);
  return idx === -1 ? 0 : idx;
}

export function getNextSOPStage(current: SOPStage): SOPStage {
  const idx = getSOPStageIndex(current);
  if (idx < 0 || idx >= SOP_STAGE_ORDER.length - 1) {
    return 'shipped';
  }
  return SOP_STAGE_ORDER[idx + 1];
}

export interface SOPMachineSnapshot {
  currentStage: SOPStage;
  stageIndex: number;
  status: 'idle' | 'running' | 'paused' | 'qa_loopback' | 'completed';
  qaRejectCount: number;
  patchCommitCount: number;
  qaApproved: boolean;
}

export function createInitialSOPSnapshot(): SOPMachineSnapshot {
  return {
    currentStage: 'briefing',
    stageIndex: 0,
    status: 'idle',
    qaRejectCount: 0,
    patchCommitCount: 0,
    qaApproved: false,
  };
}

export function transitionSOPMachine(
  snapshot: SOPMachineSnapshot,
  event: SimulationEvent
): SOPMachineSnapshot {
  switch (event.type) {
    case 'STEP_START': {
      return {
        ...snapshot,
        currentStage: event.stage,
        stageIndex: getSOPStageIndex(event.stage),
        status: event.stage === 'shipped' ? 'running' : 'running',
      };
    }
    case 'QA_REJECT_LOOPBACK': {
      return {
        ...snapshot,
        currentStage: event.returnToStage,
        stageIndex: getSOPStageIndex(event.returnToStage),
        status: 'qa_loopback',
        qaRejectCount: snapshot.qaRejectCount + 1,
      };
    }
    case 'COMMIT_CREATED': {
      return {
        ...snapshot,
        patchCommitCount: event.commit.isPatch
          ? snapshot.patchCommitCount + 1
          : snapshot.patchCommitCount,
        status: snapshot.status === 'qa_loopback' ? 'running' : snapshot.status,
      };
    }
    case 'QA_APPROVAL_PULSE': {
      return {
        ...snapshot,
        currentStage: 'qa_review',
        stageIndex: getSOPStageIndex('qa_review'),
        status: 'running',
        qaApproved: true,
      };
    }
    case 'MISSION_COMPLETE': {
      return {
        ...snapshot,
        currentStage: 'shipped',
        stageIndex: getSOPStageIndex('shipped'),
        status: 'completed',
        qaApproved: true,
      };
    }
    default:
      return snapshot;
  }
}

export class AutonomousSimulationController {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private activePlan: BuiltMissionPlan | null = null;
  private cursor = 0;
  private isRunning = false;
  private isPaused = false;
  private speed: 1 | 2 | 5 = 1;
  private onEventCallback: ((event: SimulationEvent, cursor: number, total: number) => void) | null =
    null;
  private shouldPauseAtStage: ((stage: SOPStage) => boolean) | null = null;

  public startMission(
    missionIdOrCustom: string,
    customPrompt: string | undefined,
    speed: 1 | 2 | 5,
    onEvent: (event: SimulationEvent, cursor: number, total: number) => void,
    shouldPauseAtStage?: (stage: SOPStage) => boolean
  ): BuiltMissionPlan {
    this.stop();
    const plan = buildMissionPlan(missionIdOrCustom, customPrompt);
    this.activePlan = plan;
    this.cursor = 0;
    this.isRunning = true;
    this.isPaused = false;
    this.speed = speed;
    this.onEventCallback = onEvent;
    this.shouldPauseAtStage = shouldPauseAtStage || null;

    this.scheduleNextTick();
    return plan;
  }

  public setSpeed(speed: 1 | 2 | 5): void {
    this.speed = speed;
  }

  public pause(): void {
    this.isPaused = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  public resume(): void {
    if (!this.activePlan || this.cursor >= this.activePlan.events.length) return;
    this.isPaused = false;
    this.isRunning = true;
    this.scheduleNextTick();
  }

  public stepForward(): void {
    if (!this.activePlan || !this.onEventCallback) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    // Dispatch events until the next major boundary (STEP_START, QA_REJECT_LOOPBACK, QA_APPROVAL_PULSE, MISSION_COMPLETE)
    const events = this.activePlan.events;
    let dispatched = 0;
    while (this.cursor < events.length) {
      const ev = events[this.cursor];
      this.cursor++;
      dispatched++;
      this.onEventCallback(ev, this.cursor, events.length);

      if (this.cursor >= events.length) {
        this.isRunning = false;
        this.isPaused = false;
        break;
      }

      const nextEv = events[this.cursor];
      if (
        dispatched >= 1 &&
        (nextEv.type === 'STEP_START' ||
          nextEv.type === 'QA_REJECT_LOOPBACK' ||
          nextEv.type === 'QA_APPROVAL_PULSE' ||
          nextEv.type === 'MISSION_COMPLETE')
      ) {
        break;
      }
    }
  }

  public stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    this.isPaused = false;
  }

  private getIntervalMs(): number {
    switch (this.speed) {
      case 5:
        return 40;
      case 2:
        return 100;
      case 1:
      default:
        return 180;
    }
  }

  private scheduleNextTick(): void {
    if (!this.isRunning || this.isPaused || !this.activePlan) return;
    if (this.timer) clearTimeout(this.timer);

    this.timer = setTimeout(() => {
      if (!this.activePlan || !this.isRunning || this.isPaused || !this.onEventCallback) return;

      if (this.cursor >= this.activePlan.events.length) {
        this.isRunning = false;
        return;
      }

      const event = this.activePlan.events[this.cursor];
      this.cursor++;
      this.onEventCallback(event, this.cursor, this.activePlan.events.length);

      // Check if checkpoint pause is enabled for this stage
      if (
        event.type === 'STEP_START' &&
        event.stage !== 'briefing' &&
        this.shouldPauseAtStage &&
        this.shouldPauseAtStage(event.stage)
      ) {
        this.pause();
        return;
      }

      if (event.type === 'MISSION_COMPLETE' || this.cursor >= this.activePlan.events.length) {
        this.isRunning = false;
        return;
      }

      this.scheduleNextTick();
    }, this.getIntervalMs());
  }
}

export const simulationController = new AutonomousSimulationController();
