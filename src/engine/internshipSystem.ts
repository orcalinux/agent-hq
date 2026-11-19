import {
  AgentProfile,
  AgentRole,
  Department,
  InternOnboardSpec,
  InternSpecialty,
  RoomLocation,
  SOPStage,
} from '../types';

export const TARGET_GRADUATION_XP = 250;

export interface LevelThreshold {
  level: 1 | 2 | 3 | 4 | 5;
  minXp: number;
  maxXp: number;
  title: string;
}

export const INTERN_LEVEL_THRESHOLDS: LevelThreshold[] = [
  { level: 1, minXp: 0, maxXp: 50, title: 'Shadow Observer' },
  { level: 2, minXp: 51, maxXp: 100, title: 'Junior Apprentice' },
  { level: 3, minXp: 101, maxXp: 175, title: 'Associate Specialist' },
  { level: 4, minXp: 176, maxXp: 249, title: 'Ready for Promotion' },
  { level: 5, minXp: 250, maxXp: 999999, title: 'Graduation Eligible' },
];

export const BUILTIN_SPECIALTIES = ['Frontend', 'Backend', 'QA', 'Architecture'] as const;

interface SpecialtyMeta {
  role: AgentRole;
  department: Department;
  room: RoomLocation;
}

const ROLE_META: Record<'frontend' | 'backend' | 'qa' | 'architect', SpecialtyMeta> = {
  frontend: { role: 'frontend', department: 'Engineering', room: 'Dev Bay' },
  backend: { role: 'backend', department: 'Engineering', room: 'Dev Bay' },
  qa: { role: 'qa', department: 'Quality & Security', room: 'QA Vault' },
  architect: { role: 'architect', department: 'Architecture', room: 'Architecture Lab' },
};

const BUILTIN_ROLE: Record<string, keyof typeof ROLE_META> = {
  Frontend: 'frontend',
  Backend: 'backend',
  QA: 'qa',
  Architecture: 'architect',
};

export function specialtyMeta(specialty: InternSpecialty, baseRole?: AgentRole): SpecialtyMeta {
  const key = BUILTIN_ROLE[specialty] ?? (baseRole && baseRole in ROLE_META ? (baseRole as keyof typeof ROLE_META) : 'backend');
  return ROLE_META[key];
}

export function skillsFor(specialty: InternSpecialty): string[] {
  return (
    SPECIALTY_SKILLS[specialty] ?? [
      `${specialty}: fundamentals`,
      `${specialty}: tools and environment`,
      `${specialty}: common patterns and pitfalls`,
      `${specialty}: testing and verification`,
      `${specialty}: production readiness`,
    ]
  );
}

export const SPECIALTY_SKILLS: Record<string, string[]> = {
  Frontend: [
    'Reactive State Synchronization',
    'GPU CSS 3D Perspective Math',
    'Zero-Flicker Canvas Rendering',
    'Streaming Diff Tree Hydration',
    'Accessibility & Keyboard HUD',
  ],
  Backend: [
    'Deterministic State Machines',
    'Lock-Free Orderbook Concurrency',
    'SSE WebStream Multiplexing',
    'Idempotent Webhook Signatures',
    'Zero-Copy Binary Serialization',
  ],
  QA: [
    'Replay Attack Vector Analysis',
    'Automated Fuzzing Harness',
    'Playwright Zero-Error Gate',
    'Cryptographic SHA-256 Attestation',
    'Race Condition Invariant Checks',
  ],
  Architecture: [
    'Mermaid Topology Synthesis',
    'Event-Driven CQRS Contracts',
    'Multi-Region Failover ADR',
    'Zero-Trust Boundary Modeling',
    'Token Budget Telemetry Design',
  ],
};

export function calculateInternLevel(xp: number): {
  level: 1 | 2 | 3 | 4 | 5;
  levelTitle: string;
  graduationEligible: boolean;
} {
  const clampedXp = Math.max(0, xp);
  if (clampedXp >= TARGET_GRADUATION_XP) {
    return {
      level: 5,
      levelTitle: 'Graduation Eligible',
      graduationEligible: true,
    };
  }
  for (let i = INTERN_LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    const entry = INTERN_LEVEL_THRESHOLDS[i];
    if (clampedXp >= entry.minXp) {
      return {
        level: entry.level,
        levelTitle: entry.title,
        graduationEligible: clampedXp >= TARGET_GRADUATION_XP,
      };
    }
  }
  return {
    level: 1,
    levelTitle: 'Shadow Observer',
    graduationEligible: false,
  };
}

export function getShadowXpForStage(stage: SOPStage): {
  xpDelta: number;
  reason: string;
  skill: string;
} {
  switch (stage) {
    case 'briefing':
      return {
        xpDelta: 15,
        reason: 'Shadowed Executive Manager mission deconstruction & SLA scoping',
        skill: 'Executive Spec Synthesis',
      };
    case 'architecture':
      return {
        xpDelta: 25,
        reason: 'Observed Chief System Architect ADR & Mermaid topology synthesis',
        skill: 'System Blueprinting & ADRs',
      };
    case 'implementation':
      return {
        xpDelta: 50,
        reason: 'Assisted Senior Engineers on multi-file code diffs & build verification',
        skill: 'Production Code Diff Generation',
      };
    case 'qa_review':
      return {
        xpDelta: 35,
        reason: 'Observed QA & Security Director vulnerability audit & patch verification',
        skill: 'Security Audit & Loopback Resolution',
      };
    case 'shipped':
      return {
        xpDelta: 25,
        reason: 'Participated in final release packaging & Executive Dossier attestation',
        skill: 'Zero-Defect Release Governance',
      };
  }
}

export function createNewInternProfile(
  spec: InternOnboardSpec,
  existingInternCount: number
): AgentProfile {
  const id = `agent-intern-${Date.now().toString(36)}-${existingInternCount + 1}`;
  const modelId = spec.model || '';
  const initialSkills = [skillsFor(spec.specialty)[0]];
  const meta = specialtyMeta(spec.specialty, spec.baseRole);
  const focusLine = spec.focus?.trim() ? ` Your learning focus: ${spec.focus.trim()}.` : '';

  return {
    id,
    name: spec.name.trim() || `Intern #${existingInternCount + 1}`,
    role: 'intern',
    specialty: spec.specialty,
    focus: spec.focus?.trim() || undefined,
    title: `AI ${spec.specialty} Intern`,
    description: `Junior ${spec.specialty} apprentice shadowing senior autonomous execution to unlock full engineering autonomy.`,
    avatar: spec.avatar || '🎓',
    accentColor: '#38BDF8',
    department: 'Incubator',
    systemPrompt:
      spec.systemPrompt ||
      `You are ${spec.name}, an AI ${spec.specialty} Intern in the Agent-HQ Incubator. Study the ${spec.specialty} domain of this project in depth, read the relevant files before changing anything, state what you learned, and have your mentor review your work.${focusLine}`,
    model: modelId,
    capabilities: ['Implementation under review', `${spec.specialty} fundamentals`],
    reviewResponsibilities: 'All output is reviewed by the N+1 senior mentor before QA.',
    taskHistory: [],
    autonomyLevel: 'Shadowing',
    status: 'idle',
    roomLocation: 'Incubator Pod',
    currentTask: `Shadowing ${spec.specialty} workflows`,
    taskProgress: 0,
    thoughtStream: [
      `Initialized shadowing link with mentor ${spec.mentorId}.`,
      `Ready to observe ${spec.specialty} SOP milestones and accumulate mastery XP.`,
    ],
    velocityMetrics: { tasksCompleted: 0, tasksFailed: 0, totalDurationMs: 0 },
    tokenUsage: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimatedCostUSD: 0,
      unpricedTokens: 0,
      calls: 0,
    },
    internship: {
      isIntern: true,
      specialty: spec.specialty,
      baseRole: meta.role,
      focus: spec.focus?.trim() || undefined,
      mentorId: spec.mentorId,
      xp: 0,
      targetXp: TARGET_GRADUATION_XP,
      level: 1,
      levelTitle: 'Shadow Observer',
      skillsLearned: initialSkills,
      graduationEligible: false,
      xpHistory: [
        {
          timestamp: Date.now(),
          xpDelta: 0,
          reason: `Onboarded into ${spec.specialty} Incubator track`,
          seniorAgentId: spec.mentorId,
        },
      ],
    },
    speechBubble: {
      text: `Reporting for duty! Shadowing ${spec.specialty} track.`,
      type: 'speech',
      timestamp: Date.now(),
    },
    canvasPosition: {
      x: 240 + (existingInternCount % 3) * 310,
      y: 620 + Math.floor(existingInternCount / 3) * 180,
    },
  };
}

export function applyInternXpGain(
  agent: AgentProfile,
  xpDelta: number,
  reason: string,
  skillUnlocked?: string,
  seniorAgentId?: string
): AgentProfile {
  if (!agent.internship) return agent;

  const newXp = agent.internship.xp + Math.max(0, xpDelta);
  const { level, levelTitle, graduationEligible } = calculateInternLevel(newXp);

  const specialtyPool = skillsFor(agent.internship.specialty);
  const nextPoolSkill = specialtyPool[Math.min(level - 1, specialtyPool.length - 1)];
  const skillsSet = new Set(agent.internship.skillsLearned);
  if (skillUnlocked) skillsSet.add(skillUnlocked);
  if (nextPoolSkill) skillsSet.add(nextPoolSkill);

  const leveledUp = level > agent.internship.level;

  return {
    ...agent,
    thoughtStream: [
      `+${xpDelta} XP: ${reason}${leveledUp ? ` -> Leveled up to Lv.${level} (${levelTitle})!` : ''}`,
      ...agent.thoughtStream.slice(0, 19),
    ],
    internship: {
      ...agent.internship,
      xp: newXp,
      level,
      levelTitle,
      graduationEligible,
      skillsLearned: Array.from(skillsSet),
      xpHistory: [
        {
          timestamp: Date.now(),
          xpDelta,
          reason,
          seniorAgentId: seniorAgentId || agent.internship.mentorId,
        },
        ...agent.internship.xpHistory.slice(0, 24),
      ],
    },
    speechBubble: {
      text: graduationEligible
        ? `${TARGET_GRADUATION_XP} XP reached — eligible for graduation`
        : `+${xpDelta} XP! (${newXp}/${agent.internship.targetXp} XP · Lv.${level})`,
      type: graduationEligible ? 'approval' : 'thought',
      timestamp: Date.now(),
    },
  };
}

export function promoteGraduatedIntern(agent: AgentProfile): AgentProfile {
  if (!agent.internship) return agent;

  const meta = specialtyMeta(agent.internship.specialty, agent.internship.baseRole);
  const newRole = meta.role;

  return {
    ...agent,
    role: newRole,
    title: `Autonomous ${agent.internship.specialty} Specialist`,
    department: meta.department,
    roomLocation: meta.room,
    autonomyLevel: 'Autonomous',
    status: 'graduated',
    accentColor: '#10B981',
    reviewResponsibilities: 'Owns its output; no longer requires N+1 mentor review.',
    thoughtStream: [
      `Graduated: promoted to Autonomous ${agent.internship.specialty} Specialist.`,
      ...agent.thoughtStream,
    ],
    internship: {
      ...agent.internship,
      isIntern: false,
      xp: Math.max(agent.internship.xp, TARGET_GRADUATION_XP),
      level: 5,
      levelTitle: 'Graduated Autonomous Engineer',
      graduationEligible: false,
      graduatedAt: new Date().toISOString(),
    },
    speechBubble: {
      text: `Promoted to Autonomous ${agent.internship.specialty} Specialist`,
      type: 'approval',
      timestamp: Date.now(),
    },
  };
}
