import { AIModelId } from './model';

export type AgentRole = 'manager' | 'architect' | 'frontend' | 'backend' | 'qa' | 'intern';

export type Department =
  | 'Executive'
  | 'Architecture'
  | 'Engineering'
  | 'Quality & Security'
  | 'Incubator';

export type AutonomyLevel = 'Autonomous' | 'Semi-Autonomous' | 'Supervised' | 'Shadowing';

export type AgentStatus =
  | 'idle'
  | 'thinking'
  | 'coding'
  | 'reviewing'
  | 'debating'
  | 'approved'
  | 'rejected'
  | 'graduated'
  | 'waiting'
  | 'error';

export type RoomLocation =
  | 'Executive Suite'
  | 'Architecture Lab'
  | 'Dev Bay'
  | 'QA Vault'
  | 'Incubator Pod';

export type InternSpecialty = string;

/** Measured from real (live) runs only. Simulated demo runs never change these numbers. */
export interface AgentVelocityMetrics {
  tasksCompleted: number;
  tasksFailed: number;
  totalDurationMs: number;
}

/** Measured from provider-reported usage on live calls. */
export interface AgentTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Sum of costs for calls whose pricing is known. */
  estimatedCostUSD: number;
  /** Part of estimatedCostUSD valued at a subscription account's API rate card (not a bill). */
  referenceCostUSD?: number;
  /** Tokens from calls whose pricing is unknown (not included in cost). */
  unpricedTokens: number;
  calls: number;
}

export interface AgentTaskRecord {
  runId: string;
  taskId: string;
  title: string;
  status: 'completed' | 'failed' | 'cancelled';
  model: string;
  durationMs: number;
  tokens: number;
  timestamp: number;
  error?: string;
}

export interface InternXpEvent {
  timestamp: number;
  xpDelta: number;
  reason: string;
  seniorAgentId?: string;
}

export interface InternProgress {
  isIntern: boolean;
  specialty: InternSpecialty;
  baseRole?: AgentRole;
  focus?: string;
  mentorId: string;
  xp: number;
  targetXp: number;
  level: 1 | 2 | 3 | 4 | 5;
  levelTitle: string;
  skillsLearned: string[];
  graduationEligible: boolean;
  graduatedAt?: string;
  xpHistory: InternXpEvent[];
}

export interface SpeechBubbleData {
  text: string;
  type: 'thought' | 'speech' | 'alert' | 'review' | 'approval';
  timestamp: number;
}

export interface AgentProfile {
  id: string;
  name: string;
  role: AgentRole;
  specialty?: string;
  focus?: string;
  title: string;
  description: string;
  avatar: string;
  accentColor: string;
  department: Department;
  systemPrompt: string;
  /** Model reference ("provider:model"). Empty string when the agent uses its role default. */
  model: AIModelId;
  capabilities: string[];
  reviewResponsibilities: string;
  taskHistory: AgentTaskRecord[];
  autonomyLevel: AutonomyLevel;
  status: AgentStatus;
  roomLocation: RoomLocation;
  currentTask?: string;
  taskProgress: number;
  thoughtStream: string[];
  velocityMetrics: AgentVelocityMetrics;
  tokenUsage: AgentTokenUsage;
  internship?: InternProgress;
  speechBubble?: SpeechBubbleData;
  waitingFor?: {
    agentId: string;
    agentName: string;
    reason: string;
  };
  canvasPosition: { x: number; y: number };
}

export interface InternOnboardSpec {
  name: string;
  specialty: InternSpecialty;
  baseRole?: AgentRole;
  focus?: string;
  mentorId: string;
  model?: AIModelId;
  avatar?: string;
  systemPrompt?: string;
}

export interface NewAgentSpec {
  name: string;
  role: AgentRole;
  specialty?: string;
  focus?: string;
  title: string;
  department: Department;
  roomLocation: RoomLocation;
  avatar?: string;
  model?: AIModelId | 'auto';
  autonomyLevel?: AutonomyLevel;
  systemPrompt?: string;
}
