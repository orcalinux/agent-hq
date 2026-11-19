import { AgentRole } from './agent';
import { AIModelId } from './model';

export type ViewMode =
  | 'workspace'
  | 'agents'
  | 'tasks'
  | 'reports'
  | 'connections'
  | 'settings';

export type MissionSource = 'live' | 'simulation';

export type SOPStage =
  | 'briefing'
  | 'architecture'
  | 'implementation'
  | 'qa_review'
  | 'shipped';

export interface SOPStageMeta {
  id: SOPStage;
  index: number;
  label: string;
  shortLabel: string;
  description: string;
  ownerRole: AgentRole;
  accentColor: string;
}

export const SOP_STAGES: SOPStageMeta[] = [
  {
    id: 'briefing',
    index: 0,
    label: 'Briefing & Deconstruction',
    shortLabel: 'Briefing',
    description: 'Executive Manager decomposes mission objectives, SLAs, and acceptance gates.',
    ownerRole: 'manager',
    accentColor: '#F59E0B',
  },
  {
    id: 'architecture',
    index: 1,
    label: 'System Architecture & ADR',
    shortLabel: 'Architecture',
    description: 'Chief System Architect synthesizes Mermaid topology, schemas, and security contracts.',
    ownerRole: 'architect',
    accentColor: '#A855F7',
  },
  {
    id: 'implementation',
    index: 2,
    label: 'Multi-File Implementation',
    shortLabel: 'Implementation',
    description: 'Senior Frontend & Backend Engineers write production code and run compiler checks.',
    ownerRole: 'frontend',
    accentColor: '#00F0FF',
  },
  {
    id: 'qa_review',
    index: 3,
    label: 'Code Review & QA Debate',
    shortLabel: 'Code Review & QA',
    description: 'QA & Security Director audits diffs, triggers reject loopbacks or cryptographic sign-off.',
    ownerRole: 'qa',
    accentColor: '#F43F5E',
  },
  {
    id: 'shipped',
    index: 4,
    label: 'Shipped & Executive Dossier',
    shortLabel: 'Shipped',
    description: 'Production release verified with Bento telemetry, browsable code, and QA certificate.',
    ownerRole: 'manager',
    accentColor: '#10B981',
  },
];

export interface KanbanTaskCard {
  id: string;
  title: string;
  description: string;
  stage: SOPStage;
  assignedAgentId: string;
  status: 'pending' | 'in_progress' | 'review' | 'rejected' | 'completed' | 'failed' | 'cancelled';
  priority: 'critical' | 'high' | 'medium' | 'low';
  dependsOn?: string[];
  output?: string;
  error?: string;
  model?: string;
  tokens?: number;
  durationMs?: number;
  startedAt?: number;
  completedAt?: number;
  attempts?: number;
  progress: number;
  commitHash?: string;
  tags: string[];
  qaFeedback?: string;
  dependsOnAgentName?: string;
  waitingReason?: string;
  n1ReviewerId?: string;
  n1ReviewerName?: string;
  n1ReviewStatus?: 'pending' | 'reviewing' | 'bug_fixed' | 'approved';
  n1ReviewNote?: string;
  updatedAt: number;
}

export interface CodeDiffHunkLine {
  type: 'add' | 'del' | 'normal';
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
}

export interface CodeDiffFile {
  id: string;
  filePath: string;
  language: string;
  agentId: string;
  stage: SOPStage;
  additions: number;
  deletions: number;
  status: 'added' | 'modified' | 'patched';
  unifiedDiff: string;
  fullContent: string;
  lines?: CodeDiffHunkLine[];
  timestamp: number;
}

export interface GitCommitEntry {
  id: string;
  hash: string;
  message: string;
  authorAgentId: string;
  authorName: string;
  stage: SOPStage;
  timestamp: number;
  additions: number;
  deletions: number;
  filesChanged: string[];
  isPatch?: boolean;
}

export interface QACertificateData {
  certificateId: string;
  missionId: string;
  missionTitle: string;
  signedByAgentId: string;
  signedByName: string;
  signedByModel: AIModelId;
  sha256Hash: string;
  timestamp: string;
  source?: MissionSource;
  /** What the hash covers, e.g. "task outputs" for live runs. */
  hashScope?: string;
  securityScore?: number;
  testsPassed?: number;
  testsTotal?: number;
  vulnerabilitiesFound?: number;
  vulnerabilitiesPatched?: number;
  zeroRegressionsCertified?: boolean;
  verificationCommand?: string;
  verificationExitCode?: number | null;
  qaVerdict?: 'approve' | 'reject';
  summaryNotes: string;
}

export interface QADebateMessage {
  id: string;
  agentId: string;
  agentName: string;
  role: AgentRole;
  verdict: 'reject' | 'patch' | 'approve' | 'comment';
  message: string;
  timestamp: number;
  targetFile?: string;
}

export interface ExecutiveDossierData {
  missionId: string;
  missionTitle: string;
  completedAt: string;
  durationSeconds: number;
  totalTokensUsed: number;
  totalCostUSD: number;
  filesCreated: number;
  linesOfCode: number;
  testsPassed: number;
  testsTotal: number;
  architectureScore: number;
  velocityTps: number;
  qaRejectionsResolved: number;
  executiveSummary: string;
  mermaidDiagram: string;
  stageDurationsSec: Record<SOPStage, number>;
  modelDistribution: Array<{
    modelId: AIModelId;
    modelName: string;
    percentage: number;
    tokens: number;
    costUSD: number;
  }>;
  internGrowthSummary: Array<{
    internId: string;
    name: string;
    xpGained: number;
    newLevel: number;
    graduated: boolean;
  }>;
  certificate: QACertificateData;
  generatedFiles: CodeDiffFile[];
}

export interface MissionPreset {
  id: string;
  title: string;
  subtitle: string;
  category: 'FinTech' | 'AI SaaS' | 'Custom';
  prompt: string;
  complexity: 'Extreme' | 'High' | 'Dynamic';
  estimatedStages: number;
  tags: string[];
  mermaidDiagram: string;
}

export interface ProposedFileChange {
  id: string;
  path: string;
  content: string;
  taskId: string;
  agentId: string;
  status: 'pending' | 'applied' | 'discarded' | 'reverted';
  appliedAt?: number;
  /** File contents before the change was applied; `null` when the change created the file. Enables undo. */
  previousContent?: string | null;
  /** Written by auto mode rather than by the user clicking Apply. */
  autoApplied?: boolean;
}

/**
 * How much the agents may do without asking.
 * - `ask`: plans need approval and every file change is applied by hand.
 * - `auto`: plans need approval; file changes approved by QA are written automatically.
 * - `full`: Build requests start running at once and QA-approved changes are written automatically.
 */
export type ApprovalMode = 'ask' | 'auto' | 'full';

export interface VerificationResult {
  command: string;
  exitCode: number | null;
  output: string;
  durationMs: number;
  ranAt: number;
}

export type MissionStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'qa_loopback'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface MissionState {
  id: string;
  presetId: string;
  source: MissionSource;
  title: string;
  prompt: string;
  /** Files the user attached to the request; every task receives their current contents. */
  contextFiles?: string[];
  currentStage: SOPStage;
  stageIndex: number;
  status: MissionStatus;
  error?: string;
  proposedChanges?: ProposedFileChange[];
  verification?: VerificationResult;
  qaNotes?: string;
  qaRejectCount?: number;
  startedAt: number;
  completedAt?: number;
  stepIndex: number;
  totalSteps: number;
  tasks: KanbanTaskCard[];
  mermaidDiagram: string;
  qaCertificate?: QACertificateData;
  dossier?: ExecutiveDossierData;
}

export type ThemeMode = 'dark' | 'light';

export type OrchestratorMode = 'ask' | 'plan' | 'build';

export interface PlanTask {
  id: string;
  title: string;
  description: string;
  stage: SOPStage;
  /** Existing agent id, or the key of an agent in `newAgents` (created on approval). */
  agentId: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  dependsOn: string[];
  /** Optional model chosen for this task; overrides the agent's model. */
  model?: string;
}

export type TeamStrategy = 'adaptive' | 'fixed';

export interface ProposedAgent {
  key: string;
  name: string;
  role: 'architect' | 'frontend' | 'backend' | 'qa';
  title: string;
  specialty?: string;
  focus?: string;
  systemPrompt: string;
  model?: string;
  reason?: string;
}

export interface OrchestratorPlan {
  summary: string;
  tasks: PlanTask[];
  newAgents?: ProposedAgent[];
  status: 'proposed' | 'approved' | 'discarded' | 'executed';
  runId?: string;
}

export interface ChatUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ManagerChatMessage {
  id: string;
  sender: 'user' | 'manager' | 'system';
  text: string;
  timestamp: number;
  mode?: OrchestratorMode;
  model?: string;
  streaming?: boolean;
  error?: string;
  usage?: ChatUsage;
  latencyMs?: number;
  attachedFiles?: string[];
  plan?: OrchestratorPlan;
  planError?: string;
}

export interface WorkspaceTreeEntry {
  path: string;
  name: string;
  type: 'file' | 'directory';
  size?: number;
}

export interface EditorBuffer {
  path: string;
  content: string;
  savedContent: string;
  language: string;
  loading: boolean;
  binary?: boolean;
  error?: string;
}

export interface EditorProblemEntry {
  id: string;
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  rule: string;
}

export interface EmailNotificationConfig {
  email: string;
  enabled: boolean;
  autoSendOnComplete: boolean;
}

export interface SentEmailRecord {
  id: string;
  to: string;
  subject: string;
  missionTitle: string;
  sentAt: string;
  bodyPreview: string;
  certificateHash: string;
  status: 'sent' | 'outbox_logged';
}

export interface RunRecord {
  id: string;
  title: string;
  source: MissionSource;
  status: MissionStatus;
  startedAt: number;
  completedAt?: number;
  tasksTotal: number;
  tasksCompleted: number;
  tasksFailed: number;
  promptTokens: number;
  completionTokens: number;
  costUSD: number;
  unpricedTokens: number;
  filesProposed: number;
  filesApplied: number;
  qaVerdict?: 'approve' | 'reject';
  qaRejectCount: number;
  certificateHash?: string;
  verification?: VerificationResult;
}

export interface ActivityEvent {
  id: string;
  timestamp: number;
  runId?: string;
  agentId?: string;
  taskId?: string;
  kind: 'run' | 'step_started' | 'step_completed' | 'step_failed' | 'review' | 'qa' | 'verification' | 'info';
  level: 'info' | 'success' | 'warn' | 'error';
  text: string;
  model?: string;
  tokens?: number;
  durationMs?: number;
}
