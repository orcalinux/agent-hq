import { AgentStatus } from './agent';
import {
  CodeDiffFile,
  ExecutiveDossierData,
  GitCommitEntry,
  KanbanTaskCard,
  QACertificateData,
  QADebateMessage,
  SOPStage,
} from './mission';

export type TerminalLogLevel =
  | 'info'
  | 'warn'
  | 'error'
  | 'qa_pass'
  | 'qa_reject'
  | 'cmd'
  | 'system';

export interface TerminalLogEntry {
  id: string;
  timestamp: number;
  formattedTime: string;
  level: TerminalLogLevel;
  text: string;
  agentId?: string;
  agentName?: string;
  stage?: SOPStage;
}

export type BeamEventType =
  | 'prompt'
  | 'architecture'
  | 'code_diff'
  | 'qa_reject'
  | 'qa_approve'
  | 'mentorship';

export interface ActiveBeamEvent {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  type: BeamEventType;
  label: string;
  color: string;
  timestamp: number;
}

export type SimulationEvent =
  | {
      type: 'STEP_START';
      stage: SOPStage;
      agentId: string;
      description: string;
      progress?: number;
    }
  | {
      type: 'THOUGHT_CHUNK';
      agentId: string;
      thought: string;
      tokensDelta?: { prompt: number; completion: number };
    }
  | {
      type: 'SPEECH_BUBBLE';
      agentId: string;
      text: string;
      bubbleType: 'thought' | 'speech' | 'alert' | 'review' | 'approval';
    }
  | {
      type: 'AGENT_STATUS_CHANGED';
      agentId: string;
      status: AgentStatus;
      currentTask?: string;
      taskProgress?: number;
      waitingFor?: {
        agentId: string;
        agentName: string;
        reason: string;
      } | null;
    }
  | {
      type: 'BEAM_FIRED';
      beam: Omit<ActiveBeamEvent, 'id' | 'timestamp'>;
    }
  | {
      type: 'TERMINAL_LOG';
      level: TerminalLogLevel;
      text: string;
      agentId?: string;
      stage?: SOPStage;
    }
  | {
      type: 'CODE_DIFF_READY';
      file: CodeDiffFile;
    }
  | {
      type: 'COMMIT_CREATED';
      commit: GitCommitEntry;
    }
  | {
      type: 'TASK_UPDATED';
      task: Partial<KanbanTaskCard> & { id: string };
    }
  | {
      type: 'QA_DEBATE_MESSAGE';
      debate: QADebateMessage;
    }
  | {
      type: 'QA_REJECT_LOOPBACK';
      reason: string;
      returnToStage: SOPStage;
      patchCommitNeeded: boolean;
      fromAgentId: string;
      toAgentId: string;
    }
  | {
      type: 'QA_APPROVAL_PULSE';
      certificate: QACertificateData;
    }
  | {
      type: 'INTERN_XP_GAINED';
      internId: string;
      xpDelta: number;
      reason: string;
      totalXp?: number;
      skillUnlocked?: string;
      seniorAgentId?: string;
    }
  | {
      type: 'MERMAID_UPDATED';
      mermaidDiagram: string;
    }
  | {
      type: 'MISSION_COMPLETE';
      dossier: ExecutiveDossierData;
    };
