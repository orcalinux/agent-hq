import type {
  AgentProfile,
  AgentRole,
  AIModelId,
  EmailNotificationConfig,
  ManagerChatMessage,
  SOPStage,
} from '../types';
import { PRELOADED_MISSIONS } from '../engine/preloadedMissions';

const EMPTY_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  estimatedCostUSD: 0,
  unpricedTokens: 0,
  calls: 0,
};

const EMPTY_VELOCITY = { tasksCompleted: 0, tasksFailed: 0, totalDurationMs: 0 };

type AgentSeed = Pick<
  AgentProfile,
  | 'id'
  | 'name'
  | 'role'
  | 'title'
  | 'description'
  | 'avatar'
  | 'accentColor'
  | 'department'
  | 'systemPrompt'
  | 'autonomyLevel'
  | 'roomLocation'
  | 'capabilities'
  | 'reviewResponsibilities'
> & { internship?: AgentProfile['internship']; canvasPosition: { x: number; y: number } };

function makeAgent(seed: AgentSeed): AgentProfile {
  return {
    ...seed,
    model: '',
    status: 'idle',
    currentTask: undefined,
    taskProgress: 0,
    thoughtStream: [],
    taskHistory: [],
    velocityMetrics: { ...EMPTY_VELOCITY },
    tokenUsage: { ...EMPTY_USAGE },
  };
}

function internship(specialty: 'Frontend' | 'Backend', mentorId: string): AgentProfile['internship'] {
  return {
    isIntern: true,
    specialty,
    mentorId,
    xp: 0,
    targetXp: 250,
    level: 1,
    levelTitle: 'Shadow Observer',
    skillsLearned: [],
    graduationEligible: false,
    xpHistory: [],
  };
}

const SEEDS: AgentSeed[] = [
  {
    id: 'agent-manager',
    name: 'Sovereign',
    role: 'manager',
    title: 'Master Orchestrator',
    description: 'Talks with you, turns requests into plans, assigns work to the team, and supervises execution.',
    avatar: 'SO',
    accentColor: '#D97706',
    department: 'Executive',
    systemPrompt:
      'You are Sovereign, the master orchestrator of an AI software engineering team (Aegis: architect; Pulse: senior frontend; Titan: senior backend; Sentinel: QA & security; Nova and Byte: junior engineers reviewed by an N+1 senior mentor). Be direct, concrete and technically precise. Ask clarifying questions when requirements are ambiguous.',
    autonomyLevel: 'Autonomous',
    roomLocation: 'Executive Suite',
    capabilities: ['Requirements analysis', 'Planning', 'Delegation', 'Progress reporting'],
    reviewResponsibilities: 'Approves the final result before it is reported as shipped.',
    canvasPosition: { x: 0, y: 0 },
  },
  {
    id: 'agent-architect',
    name: 'Aegis',
    role: 'architect',
    title: 'Chief Architect',
    description: 'Designs system structure, data models and API contracts before implementation starts.',
    avatar: 'AE',
    accentColor: '#7C3AED',
    department: 'Architecture',
    systemPrompt:
      'You are Aegis, the chief software architect. Produce clear architecture decisions, data models, interfaces and file layouts. Prefer simple designs. State trade-offs explicitly.',
    autonomyLevel: 'Autonomous',
    roomLocation: 'Architecture Lab',
    capabilities: ['System design', 'Data modeling', 'API contracts', 'ADRs'],
    reviewResponsibilities: 'Reviews implementation for conformance with the architecture.',
    canvasPosition: { x: 0, y: 0 },
  },
  {
    id: 'agent-frontend',
    name: 'Pulse',
    role: 'frontend',
    title: 'Senior Frontend Engineer',
    description: 'Builds user interfaces and mentors frontend juniors through N+1 review.',
    avatar: 'PU',
    accentColor: '#2563EB',
    department: 'Engineering',
    systemPrompt:
      'You are Pulse, a senior frontend engineer. Write production-quality, accessible UI code. When reviewing junior work, fix defects and explain them briefly.',
    autonomyLevel: 'Autonomous',
    roomLocation: 'Dev Bay',
    capabilities: ['UI implementation', 'Accessibility', 'State management', 'Code review'],
    reviewResponsibilities: 'N+1 mentor: reviews all frontend work by Nova.',
    canvasPosition: { x: 0, y: 0 },
  },
  {
    id: 'agent-backend',
    name: 'Titan',
    role: 'backend',
    title: 'Senior Backend Engineer',
    description: 'Implements services, APIs and data access, and mentors backend juniors through N+1 review.',
    avatar: 'TI',
    accentColor: '#059669',
    department: 'Engineering',
    systemPrompt:
      'You are Titan, a senior backend engineer. Write correct, secure, well-structured server code with input validation and error handling. When reviewing junior work, fix defects and explain them briefly.',
    autonomyLevel: 'Autonomous',
    roomLocation: 'Dev Bay',
    capabilities: ['APIs', 'Databases', 'Concurrency', 'Code review'],
    reviewResponsibilities: 'N+1 mentor: reviews all backend work by Byte.',
    canvasPosition: { x: 0, y: 0 },
  },
  {
    id: 'agent-qa',
    name: 'Sentinel',
    role: 'qa',
    title: 'QA & Security Lead',
    description: 'Reviews deliverables for defects and security issues and decides whether work ships or goes back.',
    avatar: 'SE',
    accentColor: '#DC2626',
    department: 'Quality & Security',
    systemPrompt:
      'You are Sentinel, the QA and security lead. Review work critically for correctness, missing requirements, security issues and test gaps. Be specific; cite the task and the problem.',
    autonomyLevel: 'Autonomous',
    roomLocation: 'QA Vault',
    capabilities: ['Code review', 'Security review', 'Test planning', 'Release sign-off'],
    reviewResponsibilities: 'Final QA gate: can reject tasks back to implementation.',
    canvasPosition: { x: 0, y: 0 },
  },
  {
    id: 'agent-intern-1',
    name: 'Nova',
    role: 'intern',
    title: 'Junior Frontend Engineer',
    description: 'Implements smaller frontend tasks; all output is reviewed by Pulse.',
    avatar: 'NO',
    accentColor: '#0891B2',
    department: 'Incubator',
    systemPrompt:
      'You are Nova, a junior frontend engineer. Implement the assigned task carefully and keep the scope small. Your work will be reviewed by your mentor Pulse.',
    autonomyLevel: 'Supervised',
    roomLocation: 'Incubator Pod',
    capabilities: ['UI components', 'Styling'],
    reviewResponsibilities: 'Output requires N+1 review by Pulse.',
    internship: internship('Frontend', 'agent-frontend'),
    canvasPosition: { x: 0, y: 0 },
  },
  {
    id: 'agent-intern-2',
    name: 'Byte',
    role: 'intern',
    title: 'Junior Backend Engineer',
    description: 'Implements smaller backend tasks; all output is reviewed by Titan.',
    avatar: 'BY',
    accentColor: '#0D9488',
    department: 'Incubator',
    systemPrompt:
      'You are Byte, a junior backend engineer. Implement the assigned task carefully and keep the scope small. Your work will be reviewed by your mentor Titan.',
    autonomyLevel: 'Supervised',
    roomLocation: 'Incubator Pod',
    capabilities: ['Endpoints', 'Data access', 'Unit tests'],
    reviewResponsibilities: 'Output requires N+1 review by Titan.',
    internship: internship('Backend', 'agent-backend'),
    canvasPosition: { x: 0, y: 0 },
  },
];

export const DEFAULT_AGENTS: Record<string, AgentProfile> = Object.fromEntries(
  SEEDS.map((seed) => [seed.id, makeAgent(seed)])
);

export const CORE_AGENT_IDS = SEEDS.map((s) => s.id);

export const DEFAULT_ROLE_MODELS: Record<AgentRole, AIModelId> = {
  manager: '',
  architect: '',
  frontend: '',
  backend: '',
  qa: '',
  intern: '',
};

export const DEFAULT_CHECKPOINTS: Record<SOPStage, boolean> = {
  briefing: false,
  architecture: false,
  implementation: false,
  qa_review: false,
  shipped: false,
};

export const DEFAULT_PRESETS = PRELOADED_MISSIONS;

export const DEFAULT_MANAGER_CHAT_MESSAGES: ManagerChatMessage[] = [];

export const DEFAULT_EMAIL_CONFIG: EmailNotificationConfig = {
  email: '',
  enabled: false,
  autoSendOnComplete: false,
};

export function emptyUsage() {
  return { ...EMPTY_USAGE };
}
