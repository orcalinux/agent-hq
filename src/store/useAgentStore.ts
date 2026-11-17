import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  ActiveBeamEvent,
  ActivityEvent,
  AgentProfile,
  AgentRole,
  AgentStatus,
  AIModelId,
  AutonomyLevel,
  ChatUsage,
  EmailNotificationConfig,
  InternOnboardSpec,
  KanbanTaskCard,
  ManagerChatMessage,
  MissionPreset,
  MissionState,
  NewAgentSpec,
  OrchestratorMode,
  TeamStrategy,
  ProposedFileChange,
  QADebateMessage,
  RunRecord,
  SentEmailRecord,
  SimulationEvent,
  SOPStage,
  TerminalLogEntry,
  ThemeMode,
  ViewMode,
  CodeDiffFile,
  GitCommitEntry,
} from '../types';
import {
  CORE_AGENT_IDS,
  DEFAULT_AGENTS,
  DEFAULT_CHECKPOINTS,
  DEFAULT_EMAIL_CONFIG,
  DEFAULT_MANAGER_CHAT_MESSAGES,
  DEFAULT_PRESETS,
  DEFAULT_ROLE_MODELS,
  emptyUsage,
} from './defaultState';
import { createNewInternProfile, promoteGraduatedIntern, applyInternXpGain } from '../engine/internshipSystem';
import { getSOPStageIndex, simulationController } from '../engine/simulationEngine';
import { safeStorage } from './storage';

export function formatClock(ts: number): string {
  const d = new Date(ts);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** The model an agent actually runs on: its own override, else the default for its role. */
export function resolveAgentModel(agent: AgentProfile | undefined, roleDefaults: Record<AgentRole, AIModelId>): AIModelId {
  if (!agent) return '';
  return agent.model || roleDefaults[agent.role] || '';
}

const LOG_LIMIT = 500;
const ACTIVITY_LIMIT = 500;

export interface AgentStoreState {
  agents: Record<string, AgentProfile>;
  selectedAgentId: string | null;
  roleDefaults: Record<AgentRole, AIModelId>;

  activeView: ViewMode;
  themeMode: ThemeMode;
  isCommandPaletteOpen: boolean;

  orchestratorMode: OrchestratorMode;
  teamStrategy: TeamStrategy;
  managerChatMessages: ManagerChatMessage[];
  emailConfig: EmailNotificationConfig;
  sentEmails: SentEmailRecord[];
  verificationCommand: string;

  activeMission: MissionState | null;
  selectedTaskId: string | null;
  missionPresets: MissionPreset[];
  terminalLogs: TerminalLogEntry[];
  activity: ActivityEvent[];
  runHistory: RunRecord[];
  activeCodeDiffs: CodeDiffFile[];
  commitHistory: GitCommitEntry[];
  qaDebateMessages: QADebateMessage[];
  qaRejectLoopCount: number;
  activeBeam: ActiveBeamEvent | null;
  activeBeams: ActiveBeamEvent[];

  isSimulating: boolean;
  isPaused: boolean;
  simulationSpeed: 1 | 2 | 5;
  checkpoints: Record<SOPStage, boolean>;
  isLiveRunning: boolean;

  // UI
  setActiveView: (view: ViewMode) => void;
  setThemeMode: (mode: ThemeMode) => void;
  toggleThemeMode: () => void;
  selectAgent: (agentId: string | null) => void;
  selectTask: (taskId: string | null) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setOrchestratorMode: (mode: OrchestratorMode) => void;
  setTeamStrategy: (strategy: TeamStrategy) => void;

  // Agents & models
  setRoleDefault: (role: AgentRole, model: AIModelId) => void;
  reassignModel: (agentId: string, model: AIModelId) => void;
  updateAgent: (agentId: string, patch: Partial<Pick<AgentProfile, 'name' | 'title' | 'description' | 'systemPrompt' | 'capabilities' | 'reviewResponsibilities' | 'autonomyLevel'>>) => void;
  updateAgentPrompt: (agentId: string, systemPrompt: string) => void;
  updateAgentAutonomy: (agentId: string, autonomyLevel: AutonomyLevel) => void;
  addCustomAgent: (spec: NewAgentSpec) => string;
  removeAgent: (agentId: string) => void;
  onboardIntern: (spec: InternOnboardSpec) => string;
  awardInternXp: (internId: string, xpDelta: number, reason: string, skillUnlocked?: string, seniorAgentId?: string) => void;
  graduateIntern: (internId: string) => void;
  resetAgentUsage: () => void;

  // Chat
  appendChatMessage: (msg: Omit<ManagerChatMessage, 'id' | 'timestamp'> & { id?: string }) => string;
  updateChatMessage: (id: string, patch: Partial<ManagerChatMessage> | ((m: ManagerChatMessage) => Partial<ManagerChatMessage>)) => void;
  clearChat: () => void;

  // Notifications (local outbox only)
  updateEmailConfig: (cfg: Partial<EmailNotificationConfig>) => void;
  sendExecutiveEmail: (customSubject?: string) => Promise<SentEmailRecord>;
  setVerificationCommand: (command: string) => void;

  // Live runs
  startLiveMission: (mission: MissionState) => void;
  updateMission: (patch: Partial<MissionState>) => void;
  updateTask: (taskId: string, patch: Partial<KanbanTaskCard>) => void;
  setAgentStatus: (agentId: string, status: AgentStatus, currentTask?: string, waitingFor?: AgentProfile['waitingFor'] | null) => void;
  recordAgentCall: (agentId: string, args: { model: string; usage?: ChatUsage; costUSD: number | null; note?: string }) => void;
  recordAgentTask: (agentId: string, record: AgentProfile['taskHistory'][number]) => void;
  logActivity: (event: Omit<ActivityEvent, 'id' | 'timestamp'>) => void;
  setProposedChangeStatus: (changeId: string, status: ProposedFileChange['status']) => void;
  finalizeRun: (record: RunRecord) => void;
  setLiveRunning: (running: boolean) => void;
  clearRunHistory: () => void;

  // Simulation (demo)
  launchMission: (missionIdOrCustom: string, customPrompt?: string) => void;
  pauseMission: () => void;
  resumeMission: () => void;
  stepForward: () => void;
  resetMission: () => void;
  setSimulationSpeed: (speed: 1 | 2 | 5) => void;
  toggleCheckpoint: (stage: SOPStage) => void;
  dispatchSimulationEvent: (event: SimulationEvent) => void;
  clearTerminalLogs: () => void;
  addTerminalLog: (entry: Omit<TerminalLogEntry, 'id' | 'timestamp' | 'formattedTime'>) => void;
}

function applyTheme(mode: ThemeMode) {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', mode);
    document.documentElement.style.colorScheme = mode;
  }
}

export const useAgentStore = create<AgentStoreState>()(
  persist(
    (set, get) => {
      const pushLog = (entry: Omit<TerminalLogEntry, 'id' | 'timestamp' | 'formattedTime'>, logs: TerminalLogEntry[]) => {
        const now = Date.now();
        return [...logs.slice(-(LOG_LIMIT - 1)), { ...entry, id: uid('log'), timestamp: now, formattedTime: formatClock(now) }];
      };

      return {
        agents: DEFAULT_AGENTS,
        selectedAgentId: null,
        roleDefaults: DEFAULT_ROLE_MODELS,

        activeView: 'workspace',
        themeMode: 'dark',
        isCommandPaletteOpen: false,

        orchestratorMode: 'ask',
        teamStrategy: 'adaptive',
        managerChatMessages: DEFAULT_MANAGER_CHAT_MESSAGES,
        emailConfig: DEFAULT_EMAIL_CONFIG,
        sentEmails: [],
        verificationCommand: '',

        activeMission: null,
        selectedTaskId: null,
        missionPresets: DEFAULT_PRESETS,
        terminalLogs: [],
        activity: [],
        runHistory: [],
        activeCodeDiffs: [],
        commitHistory: [],
        qaDebateMessages: [],
        qaRejectLoopCount: 0,
        activeBeam: null,
        activeBeams: [],

        isSimulating: false,
        isPaused: false,
        simulationSpeed: 1,
        checkpoints: DEFAULT_CHECKPOINTS,
        isLiveRunning: false,

        // ---------------------------------------------------------- UI
        setActiveView: (view) => set({ activeView: view }),
        setThemeMode: (mode) => {
          applyTheme(mode);
          set({ themeMode: mode });
        },
        toggleThemeMode: () => get().setThemeMode(get().themeMode === 'dark' ? 'light' : 'dark'),
        selectAgent: (agentId) => set({ selectedAgentId: agentId }),
        selectTask: (taskId) => set({ selectedTaskId: taskId }),
        setCommandPaletteOpen: (open) => set({ isCommandPaletteOpen: open }),
        setOrchestratorMode: (mode) => set({ orchestratorMode: mode }),
        setTeamStrategy: (strategy) => set({ teamStrategy: strategy }),

        // ---------------------------------------------------------- Agents & models
        setRoleDefault: (role, model) => set((s) => ({ roleDefaults: { ...s.roleDefaults, [role]: model } })),

        reassignModel: (agentId, model) =>
          set((s) => {
            const target = s.agents[agentId];
            if (!target) return s;
            return {
              agents: { ...s.agents, [agentId]: { ...target, model } },
              terminalLogs: pushLog(
                {
                  level: 'system',
                  agentId,
                  agentName: target.name,
                  text: model ? `Model set to ${model}` : 'Model reset to role default',
                },
                s.terminalLogs
              ),
            };
          }),

        updateAgent: (agentId, patch) =>
          set((s) => (s.agents[agentId] ? { agents: { ...s.agents, [agentId]: { ...s.agents[agentId], ...patch } } } : s)),

        updateAgentPrompt: (agentId, systemPrompt) => get().updateAgent(agentId, { systemPrompt }),
        updateAgentAutonomy: (agentId, autonomyLevel) => get().updateAgent(agentId, { autonomyLevel }),

        addCustomAgent: (spec) => {
          const count = Object.keys(get().agents).length;
          const id = `agent-${spec.role}-${Date.now().toString(36)}-${count + 1}`;
          const name = spec.name.trim() || `Agent ${count + 1}`;
          const agent: AgentProfile = {
            id,
            name,
            role: spec.role,
            title: spec.title.trim() || `${spec.role[0].toUpperCase()}${spec.role.slice(1)} specialist`,
            description: `Custom ${spec.department} agent.`,
            avatar: name.slice(0, 2).toUpperCase(),
            accentColor: '#64748B',
            department: spec.department,
            systemPrompt: spec.systemPrompt || `You are ${name}, ${spec.title || 'a specialist'} on an AI software engineering team.`,
            model: !spec.model || spec.model === 'auto' ? '' : spec.model,
            capabilities: [],
            reviewResponsibilities: '',
            taskHistory: [],
            autonomyLevel: spec.autonomyLevel || 'Autonomous',
            status: 'idle',
            roomLocation: spec.roomLocation,
            taskProgress: 0,
            thoughtStream: [],
            velocityMetrics: { tasksCompleted: 0, tasksFailed: 0, totalDurationMs: 0 },
            tokenUsage: emptyUsage(),
            canvasPosition: { x: 0, y: 0 },
          };
          set((s) => ({
            agents: { ...s.agents, [id]: agent },
            selectedAgentId: id,
            terminalLogs: pushLog({ level: 'system', agentId: id, agentName: name, text: `Agent ${name} added (${spec.role})` }, s.terminalLogs),
          }));
          return id;
        },

        removeAgent: (agentId) =>
          set((s) => {
            if (CORE_AGENT_IDS.includes(agentId) || !s.agents[agentId]) return s;
            const agents = { ...s.agents };
            delete agents[agentId];
            return { agents, selectedAgentId: s.selectedAgentId === agentId ? null : s.selectedAgentId };
          }),

        onboardIntern: (spec) => {
          const existing = Object.values(get().agents).filter((a) => a.role === 'intern' || a.internship).length;
          const mentor = get().agents[spec.mentorId];
          const intern: AgentProfile = {
            ...createNewInternProfile(spec, existing),
            avatar: (spec.name.trim() || 'IN').slice(0, 2).toUpperCase(),
            waitingFor: {
              agentId: spec.mentorId,
              agentName: `${mentor?.name || spec.mentorId} (N+1 Mentor)`,
              reason: 'N+1 Senior Mentor code review & bug-fix gate',
            },
          };
          set((s) => ({
            agents: { ...s.agents, [intern.id]: intern },
            selectedAgentId: intern.id,
            terminalLogs: pushLog(
              { level: 'info', agentId: intern.id, agentName: intern.name, text: `Onboarded ${intern.name}, mentored by ${mentor?.name ?? spec.mentorId}` },
              s.terminalLogs
            ),
          }));
          return intern.id;
        },

        awardInternXp: (internId, xpDelta, reason, skillUnlocked, seniorAgentId) =>
          set((s) => {
            const target = s.agents[internId];
            if (!target?.internship) return s;
            const updated = applyInternXpGain(target, xpDelta, reason, skillUnlocked, seniorAgentId);
            return {
              agents: { ...s.agents, [internId]: updated },
              terminalLogs: pushLog(
                { level: 'info', agentId: internId, agentName: target.name, text: `+${xpDelta} XP — ${reason}` },
                s.terminalLogs
              ),
            };
          }),

        graduateIntern: (internId) =>
          set((s) => {
            const target = s.agents[internId];
            if (!target?.internship) return s;
            const graduated = promoteGraduatedIntern(target);
            return {
              agents: { ...s.agents, [internId]: { ...graduated, waitingFor: undefined } },
              terminalLogs: pushLog(
                { level: 'qa_pass', agentId: internId, agentName: target.name, text: `${target.name} graduated to ${graduated.title}` },
                s.terminalLogs
              ),
            };
          }),

        resetAgentUsage: () =>
          set((s) => ({
            agents: Object.fromEntries(
              Object.entries(s.agents).map(([id, a]) => [
                id,
                { ...a, tokenUsage: emptyUsage(), velocityMetrics: { tasksCompleted: 0, tasksFailed: 0, totalDurationMs: 0 }, taskHistory: [] },
              ])
            ),
          })),

        // ---------------------------------------------------------- Chat
        appendChatMessage: (msg) => {
          const id = msg.id ?? uid('msg');
          set((s) => ({ managerChatMessages: [...s.managerChatMessages, { ...msg, id, timestamp: Date.now() }] }));
          return id;
        },
        updateChatMessage: (id, patch) =>
          set((s) => ({
            managerChatMessages: s.managerChatMessages.map((m) =>
              m.id === id ? { ...m, ...(typeof patch === 'function' ? patch(m) : patch) } : m
            ),
          })),
        clearChat: () => set({ managerChatMessages: [] }),

        // ---------------------------------------------------------- Notifications
        updateEmailConfig: (cfg) => set((s) => ({ emailConfig: { ...s.emailConfig, ...cfg } })),
        sendExecutiveEmail: async (customSubject) => {
          const s = get();
          const missionTitle = s.activeMission?.title || 'No mission';
          const record: SentEmailRecord = {
            id: uid('email'),
            to: s.emailConfig.email.trim(),
            subject: customSubject || `[Agent HQ] ${missionTitle}`,
            missionTitle,
            sentAt: new Date().toISOString(),
            bodyPreview: s.activeMission?.qaNotes || `Run status: ${s.activeMission?.status ?? 'n/a'}`,
            certificateHash: s.activeMission?.qaCertificate?.sha256Hash || '',
            status: 'outbox_logged',
          };
          set((prev) => ({ sentEmails: [record, ...prev.sentEmails.slice(0, 49)] }));
          return record;
        },
        setVerificationCommand: (command) => set({ verificationCommand: command }),

        // ---------------------------------------------------------- Live runs
        startLiveMission: (mission) => {
          simulationController.stop();
          set({
            activeMission: mission,
            selectedTaskId: null,
            isSimulating: false,
            isPaused: false,
            isLiveRunning: true,
            qaRejectLoopCount: 0,
            qaDebateMessages: [],
            activeCodeDiffs: [],
            commitHistory: [],
          });
        },
        updateMission: (patch) => set((s) => (s.activeMission ? { activeMission: { ...s.activeMission, ...patch } } : s)),
        updateTask: (taskId, patch) =>
          set((s) =>
            s.activeMission
              ? {
                  activeMission: {
                    ...s.activeMission,
                    tasks: s.activeMission.tasks.map((t) => (t.id === taskId ? { ...t, ...patch, updatedAt: Date.now() } : t)),
                  },
                }
              : s
          ),
        setAgentStatus: (agentId, status, currentTask, waitingFor) =>
          set((s) => {
            const a = s.agents[agentId];
            if (!a) return s;
            return {
              agents: {
                ...s.agents,
                [agentId]: {
                  ...a,
                  status,
                  currentTask: currentTask ?? (status === 'idle' ? undefined : a.currentTask),
                  waitingFor: waitingFor === null ? undefined : (waitingFor ?? a.waitingFor),
                },
              },
            };
          }),
        recordAgentCall: (agentId, { usage, costUSD, note }) =>
          set((s) => {
            const a = s.agents[agentId];
            if (!a) return s;
            const inT = usage?.inputTokens ?? 0;
            const outT = usage?.outputTokens ?? 0;
            const total = usage?.totalTokens ?? inT + outT;
            const u = a.tokenUsage;
            return {
              agents: {
                ...s.agents,
                [agentId]: {
                  ...a,
                  thoughtStream: note ? [note, ...a.thoughtStream.slice(0, 29)] : a.thoughtStream,
                  tokenUsage: {
                    promptTokens: u.promptTokens + inT,
                    completionTokens: u.completionTokens + outT,
                    totalTokens: u.totalTokens + total,
                    estimatedCostUSD: u.estimatedCostUSD + (costUSD ?? 0),
                    unpricedTokens: u.unpricedTokens + (costUSD === null ? total : 0),
                    calls: u.calls + 1,
                  },
                },
              },
            };
          }),
        recordAgentTask: (agentId, record) =>
          set((s) => {
            const a = s.agents[agentId];
            if (!a) return s;
            const v = a.velocityMetrics;
            return {
              agents: {
                ...s.agents,
                [agentId]: {
                  ...a,
                  taskHistory: [record, ...a.taskHistory.slice(0, 49)],
                  velocityMetrics: {
                    tasksCompleted: v.tasksCompleted + (record.status === 'completed' ? 1 : 0),
                    tasksFailed: v.tasksFailed + (record.status === 'failed' ? 1 : 0),
                    totalDurationMs: v.totalDurationMs + record.durationMs,
                  },
                },
              },
            };
          }),
        logActivity: (event) =>
          set((s) => {
            const now = Date.now();
            const agent = event.agentId ? s.agents[event.agentId] : undefined;
            const level: TerminalLogEntry['level'] =
              event.level === 'error' ? 'error' : event.level === 'warn' ? 'warn' : event.level === 'success' ? 'qa_pass' : 'info';
            return {
              activity: [...s.activity.slice(-(ACTIVITY_LIMIT - 1)), { ...event, id: uid('act'), timestamp: now }],
              terminalLogs: pushLog({ level, text: event.text, agentId: event.agentId, agentName: agent?.name }, s.terminalLogs),
            };
          }),
        setProposedChangeStatus: (changeId, status) =>
          set((s) =>
            s.activeMission
              ? {
                  activeMission: {
                    ...s.activeMission,
                    proposedChanges: (s.activeMission.proposedChanges ?? []).map((c) =>
                      c.id === changeId ? { ...c, status, appliedAt: status === 'applied' ? Date.now() : c.appliedAt } : c
                    ),
                  },
                }
              : s
          ),
        finalizeRun: (record) =>
          set((s) => ({ runHistory: [record, ...s.runHistory.filter((r) => r.id !== record.id)].slice(0, 100) })),
        setLiveRunning: (running) => set({ isLiveRunning: running }),
        clearRunHistory: () => set({ runHistory: [] }),

        // ---------------------------------------------------------- Simulation (demo)
        launchMission: (missionIdOrCustom, customPrompt) => {
          if (get().isLiveRunning) return;
          const now = Date.now();
          const plan = simulationController.startMission(
            missionIdOrCustom,
            customPrompt,
            get().simulationSpeed,
            (ev, cursor, total) => {
              get().dispatchSimulationEvent(ev);
              set((s) => (s.activeMission ? { activeMission: { ...s.activeMission, stepIndex: cursor, totalSteps: total } } : s));
            },
            (stage) => {
              const shouldPause = get().checkpoints[stage];
              if (shouldPause) {
                set((s) => ({ isPaused: true, activeMission: s.activeMission ? { ...s.activeMission, status: 'paused' } : null }));
              }
              return shouldPause;
            }
          );
          set((prev) => ({
            isSimulating: true,
            isPaused: false,
            qaRejectLoopCount: 0,
            qaDebateMessages: [],
            activeCodeDiffs: [],
            commitHistory: [],
            selectedTaskId: null,
            agents: Object.fromEntries(
              Object.entries(prev.agents).map(([id, a]) => [id, { ...a, status: 'idle' as AgentStatus, currentTask: undefined, waitingFor: undefined }])
            ),
            activeMission: {
              id: `sim-${now}`,
              presetId: plan.preset.id,
              source: 'simulation',
              title: plan.preset.title,
              prompt: plan.preset.prompt,
              currentStage: 'briefing',
              stageIndex: 0,
              status: 'running',
              startedAt: now,
              stepIndex: 0,
              totalSteps: plan.events.length,
              tasks: plan.initialTasks,
              mermaidDiagram: plan.preset.mermaidDiagram,
            },
            terminalLogs: pushLog({ level: 'system', text: `[SIMULATION] Demo run started: "${plan.preset.title}" (scripted, no models are called)` }, prev.terminalLogs),
          }));
        },
        pauseMission: () => {
          simulationController.pause();
          set((s) => ({ isPaused: true, activeMission: s.activeMission ? { ...s.activeMission, status: 'paused' } : null }));
        },
        resumeMission: () => {
          simulationController.resume();
          set((s) => ({ isPaused: false, isSimulating: true, activeMission: s.activeMission ? { ...s.activeMission, status: 'running' } : null }));
        },
        stepForward: () => {
          const s = get();
          if (!s.activeMission || s.activeMission.source !== 'simulation' || s.activeMission.status === 'completed') {
            get().launchMission('fintech-crypto');
            simulationController.pause();
          }
          simulationController.stepForward();
        },
        resetMission: () => {
          simulationController.stop();
          set((s) => ({
            isSimulating: false,
            isPaused: false,
            activeMission: s.activeMission?.source === 'simulation' ? null : s.activeMission,
            activeCodeDiffs: [],
            commitHistory: [],
            qaDebateMessages: [],
            activeBeam: null,
            activeBeams: [],
            agents: Object.fromEntries(
              Object.entries(s.agents).map(([id, a]) => [id, { ...a, status: 'idle' as AgentStatus, currentTask: undefined, waitingFor: undefined, speechBubble: undefined }])
            ),
          }));
        },
        setSimulationSpeed: (speed) => {
          simulationController.setSpeed(speed);
          set({ simulationSpeed: speed });
        },
        toggleCheckpoint: (stage) => set((s) => ({ checkpoints: { ...s.checkpoints, [stage]: !s.checkpoints[stage] } })),
        clearTerminalLogs: () => set({ terminalLogs: [] }),
        addTerminalLog: (entry) => set((s) => ({ terminalLogs: pushLog(entry, s.terminalLogs) })),

        dispatchSimulationEvent: (event) => {
          const now = Date.now();
          set((state) => {
            switch (event.type) {
              case 'STEP_START': {
                const target = state.agents[event.agentId];
                return {
                  agents: target
                    ? { ...state.agents, [event.agentId]: { ...target, currentTask: event.description, taskProgress: event.progress ?? target.taskProgress } }
                    : state.agents,
                  activeMission: state.activeMission
                    ? { ...state.activeMission, currentStage: event.stage, stageIndex: getSOPStageIndex(event.stage), status: 'running' }
                    : null,
                };
              }
              case 'AGENT_STATUS_CHANGED': {
                const target = state.agents[event.agentId];
                if (!target) return state;
                return {
                  agents: {
                    ...state.agents,
                    [event.agentId]: {
                      ...target,
                      status: event.status,
                      currentTask: event.currentTask ?? target.currentTask,
                      taskProgress: event.taskProgress ?? target.taskProgress,
                      waitingFor: event.waitingFor === null ? undefined : event.waitingFor !== undefined ? event.waitingFor : target.waitingFor,
                    },
                  },
                };
              }
              case 'THOUGHT_CHUNK': {
                // Simulated thoughts are shown but never counted as token usage.
                const target = state.agents[event.agentId];
                if (!target) return state;
                return {
                  agents: { ...state.agents, [event.agentId]: { ...target, thoughtStream: [`[sim] ${event.thought}`, ...target.thoughtStream.slice(0, 29)] } },
                };
              }
              case 'SPEECH_BUBBLE': {
                const target = state.agents[event.agentId];
                if (!target) return state;
                return {
                  agents: { ...state.agents, [event.agentId]: { ...target, speechBubble: { text: event.text, type: event.bubbleType, timestamp: now } } },
                };
              }
              case 'BEAM_FIRED': {
                const beam: ActiveBeamEvent = { ...event.beam, id: uid('beam'), timestamp: now };
                return { activeBeam: beam, activeBeams: [beam, ...state.activeBeams.slice(0, 7)] };
              }
              case 'TERMINAL_LOG': {
                const agent = event.agentId ? state.agents[event.agentId] : undefined;
                return {
                  terminalLogs: pushLog(
                    { level: event.level, text: `[sim] ${event.text}`, agentId: event.agentId, agentName: agent?.name, stage: event.stage },
                    state.terminalLogs
                  ),
                };
              }
              case 'CODE_DIFF_READY': {
                const exists = state.activeCodeDiffs.some((d) => d.id === event.file.id);
                return {
                  activeCodeDiffs: exists
                    ? state.activeCodeDiffs.map((d) => (d.id === event.file.id ? event.file : d))
                    : [...state.activeCodeDiffs, event.file],
                };
              }
              case 'COMMIT_CREATED':
                return { commitHistory: [event.commit, ...state.commitHistory] };
              case 'TASK_UPDATED': {
                if (!state.activeMission) return state;
                return {
                  activeMission: {
                    ...state.activeMission,
                    tasks: state.activeMission.tasks.map((t) => (t.id === event.task.id ? { ...t, ...event.task, updatedAt: now } : t)),
                  },
                };
              }
              case 'QA_DEBATE_MESSAGE':
                return { qaDebateMessages: [...state.qaDebateMessages, event.debate] };
              case 'QA_REJECT_LOOPBACK': {
                const beam: ActiveBeamEvent = {
                  id: uid('beam'),
                  fromAgentId: event.fromAgentId,
                  toAgentId: event.toAgentId,
                  type: 'qa_reject',
                  label: 'QA reject',
                  color: '#DC2626',
                  timestamp: now,
                };
                const agents = { ...state.agents };
                if (agents[event.fromAgentId]) agents[event.fromAgentId] = { ...agents[event.fromAgentId], status: 'rejected' };
                if (agents[event.toAgentId]) agents[event.toAgentId] = { ...agents[event.toAgentId], status: 'debating' };
                return {
                  agents,
                  qaRejectLoopCount: state.qaRejectLoopCount + 1,
                  activeBeam: beam,
                  activeBeams: [beam, ...state.activeBeams.slice(0, 7)],
                  activeMission: state.activeMission
                    ? {
                        ...state.activeMission,
                        currentStage: event.returnToStage,
                        stageIndex: getSOPStageIndex(event.returnToStage),
                        status: 'qa_loopback',
                        qaRejectCount: (state.activeMission.qaRejectCount ?? 0) + 1,
                        tasks: state.activeMission.tasks.map((t) =>
                          t.id === 'task-4' || t.id === 'task-5' ? { ...t, status: 'rejected', qaFeedback: event.reason } : t
                        ),
                      }
                    : null,
                };
              }
              case 'QA_APPROVAL_PULSE': {
                const beam: ActiveBeamEvent = {
                  id: uid('beam'),
                  fromAgentId: 'agent-qa',
                  toAgentId: 'agent-manager',
                  type: 'qa_approve',
                  label: 'QA approved',
                  color: '#059669',
                  timestamp: now,
                };
                const agents = { ...state.agents };
                for (const key of Object.keys(agents)) {
                  if (agents[key].role !== 'intern') agents[key] = { ...agents[key], status: 'approved', taskProgress: 100 };
                }
                return {
                  agents,
                  activeBeam: beam,
                  activeBeams: [beam, ...state.activeBeams.slice(0, 7)],
                  activeMission: state.activeMission ? { ...state.activeMission, qaCertificate: { ...event.certificate, source: 'simulation' } } : null,
                };
              }
              case 'INTERN_XP_GAINED': {
                // Simulated XP is logged only; it does not change persistent intern progress.
                const beam: ActiveBeamEvent = {
                  id: uid('beam'),
                  fromAgentId: event.seniorAgentId || 'agent-frontend',
                  toAgentId: event.internId,
                  type: 'mentorship',
                  label: 'mentorship',
                  color: '#0891B2',
                  timestamp: now,
                };
                return {
                  activeBeam: beam,
                  activeBeams: [beam, ...state.activeBeams.slice(0, 7)],
                  terminalLogs: pushLog({ level: 'info', text: `[sim] Intern shadowing: ${event.reason}` }, state.terminalLogs),
                };
              }
              case 'MERMAID_UPDATED':
                return state.activeMission ? { activeMission: { ...state.activeMission, mermaidDiagram: event.mermaidDiagram } } : state;
              case 'MISSION_COMPLETE': {
                const agents = { ...state.agents };
                for (const [id, agent] of Object.entries(agents)) {
                  agents[id] = { ...agent, status: agent.status === 'graduated' ? 'graduated' : 'approved', taskProgress: 100, waitingFor: undefined };
                }
                return {
                  isSimulating: false,
                  isPaused: false,
                  agents,
                  activeMission: state.activeMission
                    ? {
                        ...state.activeMission,
                        currentStage: 'shipped',
                        stageIndex: 4,
                        status: 'completed',
                        completedAt: now,
                        qaCertificate: { ...event.dossier.certificate, source: 'simulation' },
                        dossier: event.dossier,
                        tasks: state.activeMission.tasks.map((t) => ({ ...t, stage: 'shipped', status: 'completed', progress: 100 })),
                      }
                    : null,
                };
              }
              default:
                return state;
            }
          });
        },
      };
    },
    {
      name: 'agent-hq.state',
      version: 2,
      storage: safeStorage,
      partialize: (s) => ({
        agents: Object.fromEntries(
          Object.entries(s.agents).map(([id, a]) => [
            id,
            { ...a, status: (a.status === 'graduated' ? 'graduated' : 'idle') as AgentStatus, currentTask: undefined, waitingFor: a.role === 'intern' ? a.waitingFor : undefined, speechBubble: undefined },
          ])
        ),
        roleDefaults: s.roleDefaults,
        themeMode: s.themeMode,
        activeView: s.activeView,
        orchestratorMode: s.orchestratorMode,
        teamStrategy: s.teamStrategy,
        managerChatMessages: s.managerChatMessages.slice(-100).map((m) => (m.streaming ? { ...m, streaming: false, error: m.error ?? 'Interrupted' } : m)),
        emailConfig: s.emailConfig,
        sentEmails: s.sentEmails,
        verificationCommand: s.verificationCommand,
        checkpoints: s.checkpoints,
        runHistory: s.runHistory,
        activity: s.activity.slice(-200),
        terminalLogs: s.terminalLogs.filter((l) => !l.text.startsWith('[sim]')).slice(-200),
        activeMission:
          s.activeMission?.source === 'live'
            ? s.activeMission.status === 'running'
              ? { ...s.activeMission, status: 'cancelled' as const, error: 'Interrupted by page reload.' }
              : s.activeMission
            : null,
      }),
      migrate: () => ({}) as AgentStoreState,
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.themeMode);
      },
    }
  )
);
