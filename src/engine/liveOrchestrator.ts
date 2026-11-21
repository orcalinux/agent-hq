import { api, streamChat } from '@/api/client';
import { canonicalizeAgentModels, resolveAgentModel, useAgentStore } from '@/store/useAgentStore';
import { pricingFor, useConnectionsStore } from '@/store/useConnectionsStore';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import {
  calculateTokenCostUSD,
  type AgentProfile,
  type ChatUsage,
  type KanbanTaskCard,
  type ManagerChatMessage,
  type MissionState,
  type OrchestratorPlan,
  type ProposedAgent,
  type ProposedFileChange,
  type RunRecord,
  type TeamStrategy,
} from '@/types';
import {
  extractFileBlocks,
  parseMentorVerdict,
  parsePlan,
  parseQaVerdict,
  stripThinking,
  topoOrder,
  truncate,
} from './orchestratorParsing';
import { EXHAUSTED_COOLDOWN_MS, isProviderExhausted, isQuotaError, pickFallbackModel } from './failover';
import { parallelLimit, planNextWave } from './scheduler';
import { selectRelevantFiles } from './taskContext';
import { autoAppliesChanges, autoStartsRuns, selectAutoApply } from './approval';
import { providerOfRef } from '@/types';
import { useMemoryStore } from '@/store/useMemoryStore';
import { juniorsOf, pickModel, suggestMentor } from './team';
import { COMPLEXITIES, COMPLEXITY_HINT, assignAgentModels, assignPlanModels, fallbackForTier, isGroupRef, rankModels, routingFor, taskComplexity, type RoutingPolicy } from './modelRouting';
import { BALANCES, activeMagpieGroups, isLowQuota, useMagpieStore } from '@/store/useMagpieStore';
import { useModelWatchStore } from '@/store/useModelWatchStore';
import { feedbackLessons, isMemoryPath, memoryBrief, noteFeedback, parseLessons, parseRemember, REFLECTION_INSTRUCTIONS, reflectionPrompt, shouldReflect, takeJournal } from './memory';

const MAX_QA_LOOPS = 1;
const QA_TASK_ID = 'qa-review';
const TASK_FILE_CONTEXT_CHARS = 60_000;

/**
 * Agent HQ talks to models as plain text. Gateways and CLIs that wrap an agent (Magpie with a Claude Code or
 * Codex account, the Claude CLI) may still offer the model their own tools; a model that tries one leaks the
 * tool call into the answer as markup. Every request says so up front.
 */
export const TEXT_ONLY_NOTICE =
  'Environment: you are answering inside Agent HQ as plain text. You have no tools here: do not call tools, run commands, browse, or write tool-call markup such as <invoke> or <function_calls>. Everything you need (project files, task context) is included in this conversation; if something is missing, say what you would need.';

let runController: AbortController | null = null;
const runTotals = { promptTokens: 0, completionTokens: 0, otherTokens: 0, costUSD: 0, unpricedTokens: 0 };
let chatController: AbortController | null = null;

const agentsState = () => useAgentStore.getState();

function isAbort(err: unknown): boolean {
  return (err as Error)?.name === 'AbortError';
}

// ------------------------------------------------------------------ model calls

interface CallResult {
  text: string;
  usage?: ChatUsage;
  latencyMs: number;
  model: string;
}

async function callAgent(
  agent: AgentProfile,
  args: { system: string; messages: Array<{ role: 'user' | 'assistant'; content: string }>; signal: AbortSignal; onDelta?: (full: string) => void; note: string; countInRun?: boolean; modelOverride?: string }
): Promise<CallResult> {
  const { roleDefaults } = agentsState();
  let model = args.modelOverride || resolveAgentModel(agent, roleDefaults);
  if (!model) {
    throw new Error(`${agent.name} has no model. Assign one in Agents or set a ${agent.role} default in Connections & Models.`);
  }
  const conns = useConnectionsStore.getState;
  const reroute = (reason: string): boolean => {
    const fallback = fallbackForTier(conns().providers, model, (id) => isProviderExhausted(conns().exhausted, id)) ?? pickFallbackModel(conns().providers, conns().exhausted, model);
    if (!fallback) return false;
    agentsState().logActivity({
      kind: 'info',
      level: 'warn',
      agentId: agent.id,
      text: `${reason} — ${agent.name} switched from ${model} to ${fallback}`,
      model: fallback,
    });
    model = fallback;
    return true;
  };
  if (isProviderExhausted(conns().exhausted, providerOfRef(model))) {
    if (!reroute(`${providerOfRef(model)} is out of credit or rate limited`)) {
      throw new Error(`${providerOfRef(model)} is out of credit or rate limited and no other connected provider is available.`);
    }
  }
  let result: Awaited<ReturnType<typeof streamChat>>;
  for (;;) {
    let full = '';
    try {
      result = await streamChat({
        model,
        system: `${args.system}\n\n${TEXT_ONLY_NOTICE}`,
        messages: args.messages,
        signal: args.signal,
        onDelta: (t) => {
          full += t;
          args.onDelta?.(full);
        },
      });
      if (result.models?.length) {
        const providerId = providerOfRef(model);
        useConnectionsStore.setState((state) => ({
          providers: state.providers.map((provider) => provider.id === providerId ? { ...provider, models: result.models! } : provider),
        }));
        canonicalizeAgentModels(result.models);
      }
      break;
    } catch (err) {
      const message = (err as Error).message ?? '';
      if (isAbort(err) || !isQuotaError(message)) throw err;
      const failedProvider = providerOfRef(model);
      if (failedProvider) conns().markExhausted(failedProvider, Date.now() + EXHAUSTED_COOLDOWN_MS);
      if (!reroute(`${failedProvider} reported: ${truncate(message, 120)}`)) throw err;
    }
  }
  const { providers, userPricing } = useConnectionsStore.getState();
  const usage = result.usage;
  const served = result.servedModel ?? model;
  const pricing = pricingFor(providers, userPricing, served);
  const cost = usage
    ? calculateTokenCostUSD(pricing, usage.inputTokens ?? 0, usage.outputTokens ?? 0, usage)
    : null;
  agentsState().recordAgentCall(agent.id, { model: served, usage, costUSD: usage ? cost : null, referenceCost: pricing?.source === 'account', note: args.note });
  if (args.countInRun) {
    runTotals.promptTokens += usage?.inputTokens ?? 0;
    runTotals.completionTokens += usage?.outputTokens ?? 0;
    const total = usage?.totalTokens ?? (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
    if (usage?.inputTokens === undefined && usage?.outputTokens === undefined) runTotals.otherTokens += usage?.totalTokens ?? 0;
    if (cost === null || !usage) runTotals.unpricedTokens += total;
    else runTotals.costUSD += cost;
  }
  return { ...result, model: served };
}

function throttle(fn: (v: string) => void, ms = 200) {
  let last = 0;
  let pending: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (pending !== null) fn(pending);
    pending = null;
    last = Date.now();
    timer = null;
  };
  const wrapped = (v: string) => {
    pending = v;
    if (Date.now() - last >= ms) flush();
    else if (!timer) timer = setTimeout(flush, ms);
  };
  wrapped.flush = () => {
    if (timer) clearTimeout(timer);
    flush();
  };
  return wrapped as typeof wrapped & { flush: () => void };
}

// ------------------------------------------------------------------ context

function projectContext(): string {
  const ws = useWorkspaceStore.getState();
  if (!ws.root) return 'No workspace is loaded.';
  const files = ws.tree.filter((e) => e.type === 'file').map((e) => e.path);
  const shown = files.slice(0, 250);
  return `Workspace: ${ws.name} (${ws.root})\nFiles (${files.length}${files.length > shown.length ? `, first ${shown.length} shown` : ''}):\n${shown.join('\n')}`;
}

async function attachmentContext(paths: string[] | undefined): Promise<string> {
  if (!paths?.length) return '';
  const parts = await fileContents(paths, Infinity);
  return `\n\nAttached files:\n${parts.join('\n\n')}`;
}

/** Reads files from open editor buffers or the workspace, stopping once the character budget is used. */
async function fileContents(paths: string[], budget: number): Promise<string[]> {
  const ws = useWorkspaceStore.getState();
  const parts: string[] = [];
  let used = 0;
  for (const p of paths) {
    if (used >= budget) {
      parts.push(`--- ${p} ---\n[omitted: context budget reached]`);
      continue;
    }
    let content = ws.buffers[p]?.content;
    if (content === undefined) {
      try {
        content = (await api.readFile(p)).content;
      } catch {
        content = '[could not read file]';
      }
    }
    const shown = truncate(content, Math.min(20_000, budget - used));
    used += shown.length;
    parts.push(`--- ${p} ---\n${shown}`);
  }
  return parts;
}

async function taskFileContext(task: KanbanTaskCard, mission: MissionState): Promise<string> {
  const ws = useWorkspaceStore.getState();
  const files = new Set(ws.tree.filter((e) => e.type === 'file').map((e) => e.path));
  const mentioned = selectRelevantFiles(`${task.title}\n${task.description}\n${task.qaFeedback ?? ''}\n${mission.prompt}`, [...files]);
  const paths = [...new Set([...(mission.contextFiles ?? []).filter((p) => files.has(p)), ...mentioned])];
  if (!paths.length) return '';
  const parts = await fileContents(paths, TASK_FILE_CONTEXT_CHARS);
  return `\n\nCurrent contents of relevant files (edit these rather than rewriting from scratch; keep everything you do not intend to change):\n${parts.join('\n\n')}`;
}

function rosterDescription(): string {
  const agents = agentsState().agents;
  return Object.values(agents)
    .map((a) => {
      const mentor = a.internship?.isIntern ? `, junior — reports to and is reviewed by ${agents[a.internship.mentorId]?.name ?? a.internship.mentorId}` : '';
      const juniors = juniorsOf(agents, a.id).map((j) => j.name);
      const mentors = juniors.length ? ` | Mentors: ${juniors.join(', ')}` : '';
      return `- ${a.id} | ${a.name} | ${a.title} (${a.role}${mentor})${a.specialty ? ` | Specialty: ${a.specialty}` : ''}${a.focus ? ` | Focus: ${a.focus}` : ''}${mentors}`;
    })
    .join('\n');
}

/** Models agents may use (only Sovereign's provider when the scope is one subscription) and the model per complexity. */
function routing() {
  const { providers, exhausted } = useConnectionsStore.getState();
  const store = agentsState();
  return routingFor(providers, {
    scope: store.modelScope,
    overrides: store.tierModels,
    sovereignModel: resolveAgentModel(store.agents['agent-manager'], store.roleDefaults),
    skip: (id) => isProviderExhausted(exhausted, id),
    results: useModelWatchStore.getState().results,
  });
}

/** Your manual setup as the router applies it: pins with their mode, locked agents, Force, Magpie groups and quota. */
function routingPolicy(models: Array<{ ref: string }>): RoutingPolicy {
  const store = agentsState();
  const inScope = new Set(models.map((m) => m.ref));
  const pinned = Object.fromEntries(Object.entries(store.tierModels).filter(([, ref]) => ref && inScope.has(ref)));
  const lockedAgents = Object.fromEntries(Object.values(store.agents).filter((a) => a.modelLocked && a.model).map((a) => [a.id, a.model]));
  return { pinned, modes: store.tierModes, force: store.forceSetup, lockedAgents, groups: activeMagpieGroups(), low: isLowQuota };
}

/** The model that really did a task: the member of a Magpie group that answered, when known. */
const servedByTask = new Map<string, string>();

function recordModelResult(model: string | undefined, passed: boolean) {
  if (model) useModelWatchStore.getState().recordResult(model, passed);
}

function availableModels(): Array<{ ref: string; name: string; provider: string; contextWindow?: number }> {
  return routing().models;
}

function modelCatalog(): string {
  const { models, peers } = routing();
  if (!models.length) return 'Available models: none besides the agents\u2019 own assignments.';
  const providerCount = new Set(models.map((m) => m.provider)).size;
  const ranked = rankModels(models, useModelWatchStore.getState().results).filter((m) => !m.duplicateOf);
  const list =
    `Available models across ${providerCount} connected provider${providerCount === 1 ? '' : 's'}, strongest first (ref | name | provider | level | strength 0-100, same scale for every vendor, adjusted by real results):\n` +
    ranked.map((m) => `- ${m.ref} | ${m.name} | ${m.provider} | ${m.tier} | ${m.score}${m.contextWindow ? ` | ${Math.round(m.contextWindow / 1000)}k context` : ''}`).join('\n');
  const store = agentsState();
  const policy = routingPolicy(models);
  const name = (ref: string) => models.find((m) => m.ref === ref)?.name ?? store.agents[ref]?.name ?? ref;
  const lockedAgents = Object.entries(policy.lockedAgents ?? {});
  const notes = [
    policy.force ? 'The user forced their setup: do NOT set "model" on tasks, it is ignored. Only rate complexity.' : '',
    lockedAgents.length ? `Agents with a locked model (their tasks always use it): ${lockedAgents.map(([id, ref]) => `${name(id)} → ${ref}`).join(', ')}.` : '',
  ].filter(Boolean);
  if (!store.complexityRouting) return [list, ...notes].join('\n\n');
  const balance = BALANCES.find((b) => b.id === useMagpieStore.getState().balance)?.label.toLowerCase() ?? 'quota left';
  const level = (c: (typeof COMPLEXITIES)[number]) => {
    const pin = policy.pinned?.[c];
    if (pin && (policy.force || policy.modes?.[c] === 'locked')) return `${pin} (${name(pin)}) — LOCKED by the user, always used`;
    if (pin) return `${pin} (${name(pin)}) — the user's preferred model; set another "model" on a task only with a one-line "modelReason"`;
    const group = policy.groups?.[c];
    if (group) return `${group} — Magpie group of ${peers[c].map(name).join(' and ')}; Magpie picks the account by ${balance}`;
    return peers[c].map((r) => `${r} (${name(r)})`).join(' or ');
  };
  return `${list}\n\nModel for each task complexity (used when a task has no "model"; equally good models take turns):\n${COMPLEXITIES.map((c) => `- ${c}: ${level(c)} — ${COMPLEXITY_HINT[c]}`).join('\n')}${notes.length ? `\n\n${notes.join('\n')}` : ''}`;
}

const ASK_INSTRUCTIONS = 'Mode: ASK. Discuss, explain, inspect and advise. Do not propose an execution plan unless asked, and do not claim to have changed any files.';

function planInstructions(strategy: TeamStrategy, byComplexity: boolean): string {
  const teamRule =
    strategy === 'adaptive'
      ? `Team design: you build the team yourself; the user does not edit it. First think about what THIS request actually needs (stack, domain, size, risk) and size the team to the work: one agent for a small fix, as many as the work needs for a large feature. There is no limit on the number of agents. Use existing roster agents where they fit. When the work needs a specialist the roster lacks (for example mobile, data/ML, DevOps, database, game, embedded, security), add it in "newAgents" with a short distinct name that is not already on the roster, a role (architect|frontend|backend|qa), a title, a specialty, focused systemPrompt instructions for this project, and a one-line reason. Always set "model" on every new agent to an exact ref from the available models: a strong model for architecture, security and hard logic, a fast and cheap one for simple, well-scoped work. For small, well-scoped work that a senior should review, add a junior instead: set "junior": true and "mentor" to the roster agent id or the key of a new senior in this plan who reviews it (N+1); prefer a mentor with the same specialty. Assign tasks to new agents by their "key". Do not add agents you do not use. New agents stay on the team for later requests and keep learning.`
      : 'Team design: use ONLY agents from the roster. Do not propose new agents.';
  return `Mode: PLAN. Produce an execution plan. Respond with ONLY a JSON object (no prose outside it) of the form:
{"summary": "one paragraph", "newAgents": [{"key": "mobile", "name": "Orion", "role": "frontend", "title": "Mobile Engineer", "specialty": "<any project domain, such as IoT & Embedded>", "focus": "<domain instructions and verification requirements>", "systemPrompt": "...", "model": "<exact model ref>", "reason": "...", "junior": false, "mentor": "<for juniors: roster agent id or new senior key>"}], "tasks": [{"id": "t1", "title": "...", "description": "concrete instructions", "stage": "briefing|architecture|implementation", "agentId": "<roster agent id or new agent key>", "complexity": "simple|standard|complex", "model": "<optional model ref for this task>", "modelReason": "<one line, only when you set model>", "priority": "critical|high|medium|low", "dependsOn": ["t0"]}]}
The role field is a workflow routing category only. Specialty is unrestricted: choose the expertise required by the project, including IoT, embedded firmware, electronics, robotics or any other domain.
Rules: as many tasks as the work needs, each one concrete and independently checkable. Split work so tasks that depend on each other say so in dependsOn (outputs of dependencies are handed to the dependent task). Juniors only get small, well-scoped tasks; their mentor reviews them automatically. Do not add a QA task: QA review by Sentinel runs automatically. Dependencies must reference earlier task ids.
${
  byComplexity
    ? 'Model choice: rate EVERY task\'s "complexity" honestly (simple, standard or complex). By default leave "model" out: the task then runs on the best model for its complexity across all connected providers, so simple work does not spend the strongest model. Set "model" yourself when another provider\'s model clearly fits a task better (for example a model known to be strong at that language or domain, a long context window for large files, or spreading parallel work over providers to avoid rate limits), and only with a ref from the available models list, and say why in "modelReason".'
    : 'Model choice: set "model" on a task only when it clearly benefits (a strong model for architecture or hard logic, a fast cheap model for simple edits); otherwise omit it and the agent\'s own model is used. Only use refs from the available models list. Still rate each task\'s "complexity".'
}
${teamRule}`;
}

// ------------------------------------------------------------------ chat

export function stopChat() {
  chatController?.abort();
}

export async function sendToOrchestrator(text: string, attachments: string[] = []) {
  const store = agentsState();
  const mode = store.orchestratorMode;
  const sovereign = store.agents['agent-manager'];
  if (!sovereign) return;
  const remember = parseRemember(text, store.agents);
  if (remember) {
    store.appendChatMessage({ sender: 'user', text, mode });
    if ('error' in remember) {
      store.appendChatMessage({ sender: 'system', text: remember.error });
      return;
    }
    const owner = remember.agentId === 'team' ? 'the team' : store.agents[remember.agentId]?.name ?? remember.agentId;
    try {
      const res = await useMemoryStore.getState().add([{ agentId: remember.agentId, kind: 'convention', text: remember.text, source: 'user' }]);
      agentsState().appendChatMessage({ sender: 'system', text: res.added.length ? `Saved to ${owner}'s memory. It is used on every relevant task from now on.` : `${owner} already knew that; the lesson was reinforced.` });
      agentsState().logActivity({ kind: 'learning', level: 'success', agentId: remember.agentId === 'team' ? undefined : remember.agentId, text: `You taught ${owner}: ${truncate(remember.text, 100)}` });
    } catch (err) {
      agentsState().appendChatMessage({ sender: 'system', text: `Could not save to memory: ${(err as Error).message}` });
    }
    return;
  }

  const history = store.managerChatMessages
    .filter((m) => (m.sender === 'user' || m.sender === 'manager') && !m.error && !m.streaming && m.text)
    .slice(-16)
    .map((m) => ({ role: (m.sender === 'user' ? 'user' : 'assistant') as 'user' | 'assistant', content: m.plan ? `[Proposed plan] ${m.plan.summary}` : m.text }));

  store.appendChatMessage({ sender: 'user', text, mode, attachedFiles: attachments.length ? attachments : undefined });
  const model = resolveAgentModel(sovereign, store.roleDefaults);
  const replyId = store.appendChatMessage({ sender: 'manager', text: '', mode, model, streaming: true });

  chatController?.abort();
  const controller = new AbortController();
  chatController = controller;

  if (mode !== 'ask' && useMagpieStore.getState().enabled) await useMagpieStore.getState().loadQuotas();
  const content = `${text}${await attachmentContext(attachments)}`;
  const lessons = await memoryBrief(sovereign.id, text);
  const system = `${sovereign.systemPrompt}${lessons}\n\n${mode === 'ask' ? ASK_INSTRUCTIONS : planInstructions(store.teamStrategy, store.complexityRouting)}\n\nTeam roster (id | name | title):\n${rosterDescription()}\n\n${mode === 'ask' ? '' : modelCatalog() + '\n\n'}${projectContext()}`;
  const update = throttle((full) => agentsState().updateChatMessage(replyId, { text: full }), 120);

  try {
    const result = await callAgent(sovereign, {
      system,
      messages: [...history, { role: 'user', content }],
      signal: controller.signal,
      onDelta: update,
      note: `Chat (${mode})`,
    });
    update.flush();
    const patch: Partial<ManagerChatMessage> = {
      text: result.text,
      streaming: false,
      usage: result.usage,
      latencyMs: result.latencyMs,
      model: result.model,
    };
    if (mode !== 'ask') {
      try {
        const plan = parsePlan(result.text, agentsState().agents, availableModels().map((m) => m.ref));
        if (agentsState().teamStrategy === 'fixed' && plan.newAgents?.length) {
          const keys = new Set(plan.newAgents.map((n) => n.key));
          plan.tasks = plan.tasks.map((t) => (keys.has(t.agentId) ? { ...t, agentId: 'agent-manager' } : t));
          plan.newAgents = [];
        }
        patch.plan = routePlanModels(plan);
      } catch (err) {
        patch.planError = `Could not read a plan from the response: ${(err as Error).message}`;
      }
    }
    agentsState().updateChatMessage(replyId, patch);
    const now = agentsState();
    if (patch.plan && autoStartsRuns(now.approvalMode, mode) && !now.isLiveRunning && !now.isSimulating) {
      now.appendChatMessage({ sender: 'system', text: 'Full access is on: running the plan without waiting for approval.' });
      now.logActivity({ kind: 'info', level: 'warn', text: 'Full access: plan started without approval' });
      void approveAndRun(replyId).catch((err) => agentsState().appendChatMessage({ sender: 'system', text: `Could not start the run: ${(err as Error).message}` }));
    }
  } catch (err) {
    update.flush();
    agentsState().updateChatMessage(replyId, (m) => ({
      streaming: false,
      error: isAbort(err) ? 'Stopped.' : (err as Error).message,
      text: m.text,
    }));
  } finally {
    if (chatController === controller) chatController = null;
  }
}

export function updatePlan(messageId: string, plan: OrchestratorPlan) {
  agentsState().updateChatMessage(messageId, { plan });
}

// ------------------------------------------------------------------ live execution

const ROLE_PLACEMENT: Record<ProposedAgent['role'], { department: AgentProfile['department']; room: AgentProfile['roomLocation'] }> = {
  architect: { department: 'Architecture', room: 'Architecture Lab' },
  frontend: { department: 'Engineering', room: 'Dev Bay' },
  backend: { department: 'Engineering', room: 'Dev Bay' },
  qa: { department: 'Quality & Security', room: 'QA Vault' },
};

/**
 * With routing by complexity, every task without a deliberate model gets the model for its complexity
 * (juniors default to simple work). Models outside the allowed scope are replaced the same way.
 */
export function routePlanModels(plan: OrchestratorPlan): OrchestratorPlan {
  const store = agentsState();
  const { models, tiers, peers } = routing();
  const allowed = new Set(models.map((m) => m.ref));
  const policy = routingPolicy(models);
  void useMagpieStore.getState().sync();
  if (!store.complexityRouting) return { ...plan, tasks: assignAgentModels(plan.tasks, allowed, policy) };
  const juniorKeys = new Set((plan.newAgents ?? []).filter((n) => n.junior).map((n) => n.key));
  return {
    ...plan,
    newAgents: plan.newAgents?.map((n) => (n.model && allowed.has(n.model) ? n : { ...n, model: tiers[n.junior ? 'simple' : n.role === 'architect' || n.role === 'qa' ? 'complex' : 'standard'] || undefined })),
    tasks: assignPlanModels(plan.tasks, { tiers, peers }, allowed, (t) => juniorKeys.has(t.agentId) || Boolean(store.agents[t.agentId]?.internship?.isIntern), policy),
  };
}

/** Creates the agents Sovereign proposed for this plan and points their tasks at the new agent ids. */
function materializeNewAgents(plan: OrchestratorPlan): OrchestratorPlan {
  const proposed = plan.newAgents ?? [];
  if (!proposed.length) return plan;
  const store = agentsState();
  const idFor = new Map<string, string>();
  const available = availableModels().map((m) => m.ref);
  const sovereignModel = resolveAgentModel(store.agents['agent-manager'], store.roleDefaults);
  const ordered = [...proposed.filter((p) => !p.junior), ...proposed.filter((p) => p.junior)];
  for (const p of ordered) {
    const existing = Object.values(store.agents).find((a) => a.name.toLowerCase() === p.name.toLowerCase());
    if (existing) {
      idFor.set(p.key, existing.id);
      continue;
    }
    const place = ROLE_PLACEMENT[p.role];
    const roleDefaults = agentsState().roleDefaults;
    const model = pickModel(p.model, p.junior ? 'intern' : p.role, roleDefaults, sovereignModel, available) || pickModel(undefined, p.role, roleDefaults, sovereignModel, available);
    if (p.junior) {
      const specialty = p.specialty || p.title;
      const current = agentsState().agents;
      const asked = p.mentor ? (idFor.get(p.mentor) ?? p.mentor) : '';
      const mentorId = current[asked] && !current[asked].internship?.isIntern ? asked : suggestMentor(current, specialty, p.role);
      const id = store.onboardIntern({ name: p.name, specialty, baseRole: p.role, focus: p.focus, mentorId, model, systemPrompt: p.systemPrompt });
      idFor.set(p.key, id);
      store.logActivity({ kind: 'info', level: 'info', agentId: id, text: `Sovereign added junior ${p.name} (${specialty}), mentored by ${agentsState().agents[mentorId]?.name ?? mentorId}${p.reason ? `: ${p.reason}` : ''}` });
      continue;
    }
    const id = store.addCustomAgent({ name: p.name, role: p.role, title: p.title, specialty: p.specialty, focus: p.focus, department: place.department, roomLocation: place.room, model, systemPrompt: p.systemPrompt });
    idFor.set(p.key, id);
    store.logActivity({ kind: 'info', level: 'info', agentId: id, text: `Sovereign added ${p.name} (${p.title})${p.reason ? `: ${p.reason}` : ''}` });
  }
  agentsState().selectAgent(null);
  return { ...plan, newAgents: [], tasks: plan.tasks.map((t) => (idFor.has(t.agentId) ? { ...t, agentId: idFor.get(t.agentId)! } : t)) };
}

function buildMission(plan: OrchestratorPlan, request: string, contextFiles?: string[]): MissionState {
  const now = Date.now();
  const id = `run-${now.toString(36)}`;
  const agents = agentsState().agents;
  const tasks: KanbanTaskCard[] = topoOrder(plan.tasks).map((t) => {
    const agent = agents[t.agentId];
    const mentorId = agent?.internship?.isIntern ? agent.internship.mentorId : undefined;
    return {
      id: t.id,
      title: t.title,
      description: t.description,
      stage: t.stage,
      assignedAgentId: t.agentId,
      status: 'pending',
      priority: t.priority,
      model: t.model,
      complexity: t.complexity,
      progress: 0,
      tags: [],
      dependsOn: t.dependsOn,
      dependsOnAgentName: t.dependsOn.length ? t.dependsOn.join(', ') : undefined,
      n1ReviewerId: mentorId,
      n1ReviewerName: mentorId ? agents[mentorId]?.name : undefined,
      n1ReviewStatus: mentorId ? 'pending' : undefined,
      attempts: 0,
      updatedAt: now,
    };
  });
  tasks.push({
    id: QA_TASK_ID,
    title: 'QA & security review',
    description: 'Sentinel reviews all task outputs and either approves the run or sends tasks back to implementation.',
    stage: 'qa_review',
    assignedAgentId: 'agent-qa',
    status: 'pending',
    priority: 'high',
    progress: 0,
    tags: ['gate'],
    dependsOn: plan.tasks.map((t) => t.id),
    attempts: 0,
    updatedAt: now,
  });
  return {
    id,
    presetId: 'live',
    source: 'live',
    title: plan.summary ? truncate(plan.summary.split(/(?<=\.)\s/)[0], 120) : truncate(request, 120),
    prompt: request,
    contextFiles: contextFiles?.length ? contextFiles : undefined,
    currentStage: 'briefing',
    stageIndex: 0,
    status: 'running',
    startedAt: now,
    stepIndex: 0,
    totalSteps: tasks.length,
    tasks,
    mermaidDiagram: '',
    proposedChanges: [],
    qaRejectCount: 0,
  };
}

function recordDecisions(plan: OrchestratorPlan) {
  const store = agentsState();
  const juniors = new Set((plan.newAgents ?? []).filter((n) => n.junior).map((n) => n.key));
  const at = Date.now();
  useModelWatchStore.getState().recordDecisions(
    plan.tasks.map((t) => ({
      at,
      task: t.title,
      agent: store.agents[t.agentId]?.name ?? plan.newAgents?.find((n) => n.key === t.agentId)?.name ?? t.agentId,
      tier: taskComplexity(t, juniors.has(t.agentId) || Boolean(store.agents[t.agentId]?.internship?.isIntern)),
      model: t.model || resolveAgentModel(store.agents[t.agentId], store.roleDefaults) || '',
      source: t.modelSource ?? (t.model ? 'sovereign' : 'agent'),
      ...(t.modelReason ? { reason: t.modelReason } : {}),
      ...(isGroupRef(t.model) ? { viaMagpie: true } : {}),
    }))
  );
}

export async function approveAndRun(messageId: string) {
  const store = agentsState();
  if (store.isLiveRunning || store.isSimulating) throw new Error('Another run is in progress.');
  const msg = store.managerChatMessages.find((m) => m.id === messageId);
  if (!msg?.plan) return;
  const idx = store.managerChatMessages.findIndex((m) => m.id === messageId);
  const requestMessage = [...store.managerChatMessages.slice(0, idx)].reverse().find((m) => m.sender === 'user');
  const request = requestMessage?.text ?? msg.plan.summary;
  recordDecisions(msg.plan);
  const plan = materializeNewAgents(msg.plan);
  const mission = buildMission(plan, request, requestMessage?.attachedFiles);
  store.updateChatMessage(messageId, { plan: { ...plan, status: 'executed', runId: mission.id } });
  store.setOrchestratorMode('build');
  store.startLiveMission(mission);
  store.logActivity({ kind: 'run', level: 'info', runId: mission.id, text: `Run started: ${mission.title} (${mission.tasks.length} tasks)` });
  store.appendChatMessage({ sender: 'system', text: `Execution started — ${mission.tasks.length} tasks. Follow progress in Tasks or the activity panel.` });
  await executeRun();
}

function currentMission(): MissionState | null {
  const m = agentsState().activeMission;
  return m && m.source === 'live' ? m : null;
}

function taskById(id: string) {
  return currentMission()?.tasks.find((t) => t.id === id);
}

async function runTask(task: KanbanTaskCard, signal: AbortSignal) {
  const store = agentsState();
  const mission = currentMission()!;
  const agent = store.agents[task.assignedAgentId];
  const started = Date.now();
  if (!agent) {
    store.updateTask(task.id, { status: 'failed', error: `Agent ${task.assignedAgentId} no longer exists.` });
    return;
  }
  const attempts = (task.attempts ?? 0) + 1;
  store.updateTask(task.id, { status: 'in_progress', progress: 10, startedAt: started, error: undefined, attempts });
  store.updateMission({ currentStage: task.stage, stageIndex: ['briefing', 'architecture', 'implementation'].indexOf(task.stage) });
  store.setAgentStatus(agent.id, agent.role === 'architect' || agent.role === 'manager' ? 'thinking' : 'coding', task.title, null);
  store.logActivity({ kind: 'step_started', level: 'info', runId: mission.id, agentId: agent.id, taskId: task.id, text: `${agent.name} started "${task.title}"` });

  const depOutputs = (task.dependsOn ?? [])
    .map((d) => taskById(d))
    .filter((d): d is KanbanTaskCard => Boolean(d?.output))
    .map((d) => `### Output of "${d.title}" (${store.agents[d.assignedAgentId]?.name})\n${truncate(stripThinking(d.output!), 8000)}`)
    .join('\n\n');

  const system = `${agent.systemPrompt}
${agent.specialty ? `\nYour specialty is ${agent.specialty}.` : ''}
${agent.focus ? `\nYour domain instructions: ${agent.focus}` : ''}

You are executing one task of a larger plan coordinated by Sovereign.
When you create or change files, output each file in full inside a fenced block whose info string contains path=<relative path>, e.g.:
\`\`\`ts path=src/example.ts
// full file content
\`\`\`
Files are only written to the project after QA approves the run. Keep explanations short.
When you change an existing file, start from its current contents (provided below when available) and preserve unrelated code.${await memoryBrief(agent.id, `${task.title}\n${task.description}\n${task.qaFeedback ?? ''}`)}`;

  const fileContext = await taskFileContext(task, mission);
  const user = `Overall request:\n${mission.prompt}\n\nYour task: ${task.title}\n${task.description}${
    task.qaFeedback ? `\n\nQA feedback to address (this task was rejected):\n${task.qaFeedback}` : ''
  }${depOutputs ? `\n\nResults from tasks you depend on:\n${depOutputs}` : ''}${fileContext}\n\n${projectContext()}`;

  const update = throttle((full) => agentsState().updateTask(task.id, { output: full, progress: Math.min(90, 10 + Math.floor(full.length / 80)) }), 250);
  try {
    let result = await callAgent(agent, { system, messages: [{ role: 'user', content: user }], signal, onDelta: update, note: `Task: ${task.title}`, countInRun: true, modelOverride: task.model });
    servedByTask.set(task.id, result.model);
    update.flush();
    let output = result.text;
    let tokens = (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0) || result.usage?.totalTokens || 0;

    // N+1 senior review for junior agents
    const mentorId = agent.internship?.isIntern ? agent.internship.mentorId : undefined;
    const mentor = mentorId ? agentsState().agents[mentorId] : undefined;
    if (mentor) {
      agentsState().updateTask(task.id, { status: 'review', n1ReviewStatus: 'reviewing', progress: 92, output });
      agentsState().setAgentStatus(agent.id, 'waiting', `Waiting for ${mentor.name}'s review`);
      agentsState().setAgentStatus(mentor.id, 'reviewing', `N+1 review: ${task.title}`);
      const review = await callAgent(mentor, {
        system: `${mentor.systemPrompt}\n\nYou are the N+1 senior mentor reviewing a junior engineer's work.${await memoryBrief(mentor.id, `${task.title}\n${task.description}`)}`,
        messages: [
          {
            role: 'user',
            content: `Task: ${task.title}\n${task.description}\n\nJunior output from ${agent.name}:\n${truncate(stripThinking(output), 16000)}\n\nReply in this exact format:\nVERDICT: APPROVE or REVISE\nNOTES: <short review notes>\nREVISED OUTPUT:\n<only if REVISE: the full corrected output, including complete file blocks>`,
          },
        ],
        signal,
        note: `N+1 review of ${agent.name}: ${task.title}`,
        countInRun: true,
      });
      tokens += (review.usage?.inputTokens ?? 0) + (review.usage?.outputTokens ?? 0) || review.usage?.totalTokens || 0;
      const verdict = parseMentorVerdict(review.text);
      if (verdict.verdict === 'revise' && verdict.revised) output = verdict.revised;
      if (verdict.verdict === 'revise') recordModelResult(result.model, false);
      if (verdict.verdict === 'revise' && verdict.notes) noteFeedback(mission.id, { agentId: agent.id, source: 'mentor', text: verdict.notes, taskId: task.id });
      agentsState().updateTask(task.id, {
        n1ReviewStatus: verdict.verdict === 'approve' ? 'approved' : 'bug_fixed',
        n1ReviewNote: verdict.notes,
      });
      agentsState().setAgentStatus(mentor.id, 'idle');
      agentsState().logActivity({
        kind: 'review',
        level: verdict.verdict === 'approve' ? 'success' : 'warn',
        runId: mission.id,
        agentId: mentor.id,
        taskId: task.id,
        text: `${mentor.name} ${verdict.verdict === 'approve' ? 'approved' : 'revised'} ${agent.name}'s work on "${task.title}"`,
      });
      agentsState().awardInternXp(
        agent.id,
        verdict.verdict === 'approve' ? 25 : 10,
        `${verdict.verdict === 'approve' ? 'Approved' : 'Revised'} in N+1 review: ${task.title}`,
        undefined,
        mentor.id
      );
      result = { ...result, latencyMs: result.latencyMs + review.latencyMs };
    }

    const durationMs = Date.now() - started;
    const blocks = extractFileBlocks(output);
    const files = blocks.filter((f) => !isMemoryPath(f.path));
    if (files.length < blocks.length) {
      agentsState().logActivity({ kind: 'learning', level: 'warn', runId: mission.id, agentId: agent.id, taskId: task.id, text: `${agent.name} tried to edit the project memory folder; those file changes were dropped` });
    }
    const changes: ProposedFileChange[] = files.map((f) => ({
      id: `${task.id}:${f.path}`,
      path: f.path,
      content: f.content,
      taskId: task.id,
      agentId: agent.id,
      status: 'pending',
    }));
    const existing = (currentMission()?.proposedChanges ?? []).filter((c) => c.taskId !== task.id || c.status === 'applied');
    agentsState().updateMission({ proposedChanges: [...existing, ...changes] });
    agentsState().updateTask(task.id, {
      status: 'completed',
      progress: 100,
      output,
      tokens: (task.tokens ?? 0) + tokens,
      durationMs,
      completedAt: Date.now(),
      model: result.model,
      tags: files.length ? [`${files.length} file${files.length > 1 ? 's' : ''}`] : [],
    });
    agentsState().setAgentStatus(agent.id, 'idle');
    agentsState().recordAgentTask(agent.id, { runId: mission.id, taskId: task.id, title: task.title, status: 'completed', model: result.model, durationMs, tokens, timestamp: Date.now() });
    agentsState().logActivity({
      kind: 'step_completed',
      level: 'success',
      runId: mission.id,
      agentId: agent.id,
      taskId: task.id,
      model: result.model,
      tokens,
      durationMs,
      text: `${agent.name} finished "${task.title}"${files.length ? ` — ${files.length} file change(s) proposed` : ''}`,
    });
  } catch (err) {
    update.flush();
    const durationMs = Date.now() - started;
    const aborted = isAbort(err);
    agentsState().updateTask(task.id, {
      status: aborted ? 'pending' : 'failed',
      error: aborted ? 'Stopped before completion.' : (err as Error).message,
      progress: 0,
      durationMs,
    });
    agentsState().setAgentStatus(agent.id, aborted ? 'idle' : 'error');
    if (agent.internship?.mentorId) agentsState().setAgentStatus(agent.internship.mentorId, 'idle');
    agentsState().recordAgentTask(agent.id, {
      runId: mission.id,
      taskId: task.id,
      title: task.title,
      status: aborted ? 'cancelled' : 'failed',
      model: task.model || resolveAgentModel(agent, agentsState().roleDefaults),
      durationMs,
      tokens: 0,
      timestamp: Date.now(),
      error: (err as Error).message,
    });
    agentsState().logActivity({
      kind: 'step_failed',
      level: aborted ? 'warn' : 'error',
      runId: mission.id,
      agentId: agent.id,
      taskId: task.id,
      text: aborted ? `${agent.name} stopped "${task.title}"` : `${agent.name} failed "${task.title}": ${(err as Error).message}`,
    });
    if (!aborted && !isQuotaError((err as Error).message)) recordModelResult(task.model || resolveAgentModel(agent, agentsState().roleDefaults), false);
    if (aborted) throw err;
  }
}

async function runQa(signal: AbortSignal): Promise<'approved' | 'rejected' | 'retry'> {
  const store = agentsState();
  const mission = currentMission()!;
  const qa = store.agents['agent-qa'];
  const workTasks = mission.tasks.filter((t) => t.id !== QA_TASK_ID);
  const started = Date.now();
  store.updateTask(QA_TASK_ID, { status: 'in_progress', progress: 20, startedAt: started, error: undefined });
  store.updateMission({ currentStage: 'qa_review', stageIndex: 3 });
  store.setAgentStatus(qa.id, 'reviewing', 'QA & security review');
  store.logActivity({ kind: 'qa', level: 'info', runId: mission.id, agentId: qa.id, text: 'Sentinel started QA review' });

  const deliverables = workTasks
    .map((t) => `## [${t.id}] ${t.title} — ${store.agents[t.assignedAgentId]?.name}\n${truncate(stripThinking(t.output ?? ''), 10_000)}`)
    .join('\n\n');
  const result = await callAgent(qa, {
    system: `${qa.systemPrompt}${await memoryBrief(qa.id, mission.prompt)}\n\nRespond with ONLY a JSON object: {"verdict": "approve" | "reject", "summary": "...", "issues": [{"taskId": "<task id>", "problem": "..."}]}. Reject only for real defects, security problems or unmet requirements.`,
    messages: [{ role: 'user', content: `Request:\n${mission.prompt}\n\nDeliverables:\n${deliverables}` }],
    signal,
    note: 'QA review',
    countInRun: true,
  });
  const tokens = (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0) || result.usage?.totalTokens || 0;
  let verdict;
  try {
    verdict = parseQaVerdict(result.text, workTasks.map((t) => t.id));
  } catch (err) {
    store.updateTask(QA_TASK_ID, { status: 'failed', error: `Could not parse QA verdict: ${(err as Error).message}`, output: result.text });
    store.setAgentStatus(qa.id, 'error');
    throw new Error('QA review returned an unreadable verdict.');
  }
  store.updateTask(QA_TASK_ID, {
    output: result.text,
    tokens: (taskById(QA_TASK_ID)?.tokens ?? 0) + tokens,
    durationMs: Date.now() - started,
    model: result.model,
  });
  store.updateMission({ qaNotes: verdict.summary });
  store.setAgentStatus(qa.id, 'idle');

  if (verdict.verdict === 'reject') {
    const rejectCount = (currentMission()?.qaRejectCount ?? 0) + 1;
    store.updateMission({ qaRejectCount: rejectCount, status: 'qa_loopback' });
    const flagged = new Set(verdict.issues.map((i) => i.taskId).filter(Boolean));
    const targets = flagged.size ? workTasks.filter((t) => flagged.has(t.id)) : workTasks;
    store.logActivity({ kind: 'qa', level: 'warn', runId: mission.id, agentId: qa.id, text: `Sentinel rejected ${targets.length} task(s): ${verdict.summary}` });
    if (rejectCount > MAX_QA_LOOPS) {
      store.updateTask(QA_TASK_ID, { status: 'rejected', progress: 100, qaFeedback: verdict.summary });
      return 'rejected';
    }
    for (const t of targets) {
      recordModelResult(servedByTask.get(t.id) ?? t.model, false);
      const feedback = verdict.issues.filter((i) => i.taskId === t.id || !i.taskId).map((i) => `- ${i.problem}`).join('\n') || verdict.summary;
      store.updateTask(t.id, { status: 'rejected', qaFeedback: feedback, stage: 'implementation' });
      noteFeedback(mission.id, { agentId: t.assignedAgentId, source: 'qa', text: `${t.title}: ${feedback}`, taskId: t.id });
    }
    store.updateTask(QA_TASK_ID, { status: 'pending', progress: 0 });
    return 'retry';
  }

  // Optional real verification command
  const command = store.verificationCommand.trim();
  if (command) {
    store.logActivity({ kind: 'verification', level: 'info', runId: mission.id, text: `Running verification: ${command}` });
    const res = await useWorkspaceStore.getState().runCommand(command);
    const verification = {
      command,
      exitCode: res.exitCode ?? null,
      output: truncate(`${res.stdout ?? ''}\n${res.stderr ?? ''}`.trim(), 20_000),
      durationMs: res.durationMs ?? 0,
      ranAt: Date.now(),
    };
    store.updateMission({ verification });
    const passed = res.exitCode === 0;
    store.logActivity({
      kind: 'verification',
      level: passed ? 'success' : 'error',
      runId: mission.id,
      text: res.rejected ? `Verification command rejected: ${res.stderr}` : `Verification ${passed ? 'passed' : `failed (exit ${res.exitCode})`}`,
    });
    if (!passed) {
      noteFeedback(mission.id, { agentId: 'team', source: 'verification', text: `"${command}" failed (exit ${res.exitCode}): ${truncate(verification.output, 500)}` });
      store.updateTask(QA_TASK_ID, { status: 'rejected', progress: 100, qaFeedback: `Verification "${command}" failed (exit ${res.exitCode}).` });
      return 'rejected';
    }
  }

  store.updateTask(QA_TASK_ID, { status: 'completed', progress: 100, completedAt: Date.now() });
  for (const t of workTasks) if (currentMission()?.tasks.find((x) => x.id === t.id)?.status === 'completed') recordModelResult(servedByTask.get(t.id) ?? currentMission()!.tasks.find((x) => x.id === t.id)!.model, true);
  store.logActivity({ kind: 'qa', level: 'success', runId: mission.id, agentId: qa.id, text: `Sentinel approved the run: ${verdict.summary}` });
  return 'approved';
}

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function finalize(status: MissionState['status'], error?: string, autoApplied?: { applied: number; failed: number }) {
  const store = agentsState();
  const mission = currentMission();
  if (!mission) return;
  const now = Date.now();
  store.updateMission({ status, error, completedAt: now });
  store.setLiveRunning(false);
  for (const a of Object.values(store.agents)) {
    if (['thinking', 'coding', 'reviewing', 'waiting'].includes(a.status)) store.setAgentStatus(a.id, 'idle');
  }
  const m = currentMission()!;
  const record: RunRecord = {
    id: m.id,
    title: m.title,
    source: 'live',
    status,
    startedAt: m.startedAt,
    completedAt: now,
    tasksTotal: m.tasks.length,
    tasksCompleted: m.tasks.filter((t) => t.status === 'completed').length,
    tasksFailed: m.tasks.filter((t) => t.status === 'failed').length,
    promptTokens: runTotals.promptTokens,
    completionTokens: runTotals.completionTokens + runTotals.otherTokens,
    costUSD: runTotals.costUSD,
    unpricedTokens: runTotals.unpricedTokens,
    filesProposed: m.proposedChanges?.length ?? 0,
    filesApplied: m.proposedChanges?.filter((c) => c.status === 'applied').length ?? 0,
    qaVerdict: m.qaCertificate?.qaVerdict,
    qaRejectCount: m.qaRejectCount ?? 0,
    certificateHash: m.qaCertificate?.sha256Hash,
    verification: m.verification,
  };
  store.finalizeRun(record);
  store.logActivity({
    kind: 'run',
    level: status === 'completed' ? 'success' : status === 'cancelled' ? 'warn' : 'error',
    runId: m.id,
    text: `Run ${status}${error ? `: ${error}` : ''}`,
  });
  store.appendChatMessage({
    sender: 'system',
    text:
      status !== 'completed'
        ? `Run ${status}${error ? `: ${error}` : '.'}`
        : autoApplied
          ? `Run completed and approved by QA. Auto mode wrote ${autoApplied.applied} file(s) to the project${autoApplied.failed ? `; ${autoApplied.failed} could not be written` : ''}. Undo any of them in the Changes panel.`
          : `Run completed and approved by QA. ${m.proposedChanges?.length ?? 0} proposed file change(s) are ready to review in the Changes panel.`,
  });
}

export async function executeRun() {
  const store = agentsState();
  const mission = currentMission();
  if (!mission) return;
  runController?.abort();
  const controller = new AbortController();
  runController = controller;
  const previous = store.runHistory.find((r) => r.id === mission.id);
  runTotals.promptTokens = previous?.promptTokens ?? 0;
  runTotals.completionTokens = previous?.completionTokens ?? 0;
  runTotals.otherTokens = 0;
  runTotals.costUSD = previous?.costUSD ?? 0;
  runTotals.unpricedTokens = previous?.unpricedTokens ?? 0;
  store.setLiveRunning(true);
  store.updateMission({ status: 'running', error: undefined });

  try {
    for (;;) {
      await runWorkTasks(controller.signal);
      const failed = currentMission()!.tasks.filter((t) => t.id !== QA_TASK_ID && t.status === 'failed');
      if (failed.length) {
        finalize('failed', `${failed.length} task(s) failed. Fix the cause and use Retry.`);
        return;
      }
      const outcome = await runQa(controller.signal);
      if (outcome === 'retry') continue;
      if (outcome === 'rejected') {
        finalize('failed', 'QA rejected the result after the allowed rework loop.');
        return;
      }
      break;
    }

    const m = currentMission()!;
    const payload = m.tasks.map((t) => `${t.id}\n${t.output ?? ''}`).join('\n\n');
    const hash = await sha256(payload);
    const qa = agentsState().agents['agent-qa'];
    agentsState().updateMission({
      currentStage: 'shipped',
      stageIndex: 4,
      tasks: m.tasks.map((t) => ({ ...t, stage: 'shipped' })),
      qaCertificate: {
        certificateId: `cert-${m.id}`,
        missionId: m.id,
        missionTitle: m.title,
        signedByAgentId: qa.id,
        signedByName: qa.name,
        signedByModel: resolveAgentModel(qa, agentsState().roleDefaults),
        sha256Hash: hash,
        hashScope: `Outputs of ${m.tasks.length} tasks`,
        timestamp: new Date().toISOString(),
        source: 'live',
        qaVerdict: 'approve',
        verificationCommand: m.verification?.command,
        verificationExitCode: m.verification?.exitCode,
        summaryNotes: m.qaNotes ?? '',
      },
    });
    const autoApplied = autoAppliesChanges(agentsState().approvalMode) ? await autoApplyChanges() : undefined;
    finalize('completed', undefined, autoApplied);
  } catch (err) {
    if (isAbort(err)) finalize('cancelled', 'Stopped by user.');
    else finalize('failed', (err as Error).message);
  } finally {
    if (runController === controller) runController = null;
    void learnFromRun(mission.id);
  }
}

/** After a run, Sovereign distills durable lessons from it into project memory. */
export async function learnFromRun(runId: string) {
  const feedback = takeJournal(runId);
  const store = agentsState();
  const mission = currentMission();
  const sovereign = store.agents['agent-manager'];
  if (!mission || mission.id !== runId || !sovereign) return;
  if (!shouldReflect(store.learningMode, mission.status, feedback.length)) return;
  const memory = useMemoryStore.getState();
  if (memory.error) return;
  const ids = Object.keys(store.agents);
  let lessons;
  try {
    const result = await callAgent(sovereign, {
      system: `${sovereign.systemPrompt}\n\n${REFLECTION_INSTRUCTIONS}`,
      messages: [{ role: 'user', content: reflectionPrompt({ mission, agents: store.agents, feedback, known: memory.lessons }) }],
      signal: new AbortController().signal,
      note: 'Learning from the run',
    });
    lessons = parseLessons(result.text, ids, runId);
  } catch (err) {
    if (!feedback.length) {
      agentsState().logActivity({ kind: 'learning', level: 'warn', runId, text: `No lessons saved from this run: ${(err as Error).message}` });
      return;
    }
    lessons = feedbackLessons(feedback, runId);
  }
  if (!lessons.length) return;
  try {
    const res = await useMemoryStore.getState().add(lessons);
    const agents = agentsState().agents;
    const byAgent = new Map<string, number>();
    for (const l of res.added) byAgent.set(l.agentId, (byAgent.get(l.agentId) ?? 0) + 1);
    for (const [agentId, count] of byAgent) {
      const who = agentId === 'team' ? 'Team memory' : agents[agentId]?.name ?? agentId;
      agentsState().logActivity({ kind: 'learning', level: 'success', runId, agentId: agentId === 'team' ? undefined : agentId, text: `${who} learned ${count} lesson${count === 1 ? '' : 's'}` });
    }
    if (res.reinforced.length) {
      agentsState().logActivity({ kind: 'learning', level: 'info', runId, text: `${res.reinforced.length} known lesson${res.reinforced.length === 1 ? ' was' : 's were'} confirmed again` });
    }
  } catch (err) {
    agentsState().logActivity({ kind: 'learning', level: 'warn', runId, text: `Could not save lessons: ${(err as Error).message}` });
  }
}

export function stopRun() {
  runController?.abort();
}

/** Runs pending work tasks in dependency waves, several at once, never two for the same agent. */
async function runWorkTasks(signal: AbortSignal) {
  const running = new Map<string, Promise<void>>();
  let fatal: unknown = null;
  for (;;) {
    if (signal.aborted && !fatal) fatal = Object.assign(new Error('Aborted'), { name: 'AbortError' });
    if (!fatal) {
      const work = topoOrder(currentMission()!.tasks.filter((t) => t.id !== QA_TASK_ID));
      const { start, blocked } = planNextWave(work, new Set(running.keys()), parallelLimit(agentsState().maxParallel));
      for (const { task, dependency } of blocked) {
        agentsState().updateTask(task.id, { status: 'failed', error: `Blocked: dependency "${dependency.title}" did not complete.` });
      }
      for (const task of start) {
        const done = runTask(task, signal)
          .catch((err) => {
            fatal ??= err;
          })
          .finally(() => running.delete(task.id));
        running.set(task.id, done);
      }
    }
    if (!running.size) break;
    await Promise.race(running.values());
  }
  if (fatal) throw fatal;
  for (const t of currentMission()!.tasks) {
    if (t.id !== QA_TASK_ID && t.status !== 'completed' && t.status !== 'failed') {
      agentsState().updateTask(t.id, { status: 'failed', error: 'Could not be scheduled: a dependency never completed.' });
    }
  }
}

export async function resumeRun() {
  const m = currentMission();
  if (!m || agentsState().isLiveRunning) return;
  for (const t of m.tasks) {
    if (t.status === 'failed' || t.status === 'cancelled' || t.status === 'in_progress' || t.status === 'review') {
      agentsState().updateTask(t.id, { status: 'pending', error: undefined });
    }
  }
  agentsState().logActivity({ kind: 'run', level: 'info', runId: m.id, text: 'Run resumed' });
  await executeRun();
}

export async function retryTask(taskId: string) {
  const m = currentMission();
  if (!m || agentsState().isLiveRunning) return;
  agentsState().updateTask(taskId, { status: 'pending', error: undefined, output: undefined });
  await resumeRun();
}

async function currentContent(path: string): Promise<string | null> {
  const file = await api.readFileIfExists(path);
  if (!file.exists) return null;
  if (file.binary) throw new Error(`${path} is a binary file; it is not overwritten.`);
  return file.content;
}

export async function applyProposedChange(changeId: string, opts: { auto?: boolean } = {}) {
  const m = currentMission();
  const change = m?.proposedChanges?.find((c) => c.id === changeId);
  if (!change || change.status === 'applied') return;
  const previousContent = await currentContent(change.path);
  await useWorkspaceStore.getState().writeAndReload(change.path, change.content);
  agentsState().updateProposedChange(changeId, { status: 'applied', appliedAt: Date.now(), previousContent, autoApplied: opts.auto || undefined });
  agentsState().logActivity({
    kind: 'info',
    level: 'success',
    runId: m!.id,
    agentId: change.agentId,
    text: `${opts.auto ? 'Auto-applied' : 'Applied'} ${change.path}${previousContent === null ? ' (new file)' : ''}`,
  });
}

/** Puts a file back the way it was before the change was applied; deletes it if the change created it. */
export async function revertProposedChange(changeId: string) {
  const m = currentMission();
  const change = m?.proposedChanges?.find((c) => c.id === changeId);
  if (!change || change.status !== 'applied' || change.previousContent === undefined) return;
  const workspace = useWorkspaceStore.getState();
  if (change.previousContent === null) {
    await api.deleteFile(change.path);
    await workspace.refreshTree();
    void workspace.loadGit();
  } else {
    await workspace.writeAndReload(change.path, change.previousContent);
  }
  agentsState().updateProposedChange(changeId, { status: 'reverted' });
  agentsState().logActivity({ kind: 'info', level: 'warn', runId: m!.id, text: `Undid ${change.path}${change.previousContent === null ? ' (deleted the new file)' : ''}` });
}

/** Auto mode: writes QA-approved changes, one per path, and keeps what each file held before so it can be undone. */
export async function autoApplyChanges(): Promise<{ applied: number; failed: number }> {
  const { apply, superseded } = selectAutoApply(currentMission()?.proposedChanges ?? []);
  for (const change of superseded) agentsState().setProposedChangeStatus(change.id, 'discarded');
  let applied = 0;
  let failed = 0;
  for (const change of apply) {
    try {
      await applyProposedChange(change.id, { auto: true });
      applied++;
    } catch (err) {
      failed++;
      agentsState().logActivity({ kind: 'info', level: 'error', runId: currentMission()?.id, text: `Could not auto-apply ${change.path}: ${(err as Error).message}` });
    }
  }
  return { applied, failed };
}
