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
  adoptMentorRevision,
  compactFileOutputs,
  extractFileBlocks,
  parseMentorVerdict,
  parsePlan,
  parseQaVerdict,
  stripThinking,
  topoOrder,
  truncate,
} from './orchestratorParsing';
import { EXHAUSTED_COOLDOWN_MS, isProviderExhausted, isQuotaError, pickFallbackModel, quotaResetAt } from './failover';
import { parallelLimit, planNextWave } from './scheduler';
import { selectRelevantFiles } from './taskContext';
import { autoAppliesChanges, autoStartsRuns, blameTasks, checkpointProposals, evidencedQaIssues, finalFileDigest, markConflicts, qaIssueKey, replaceMergedProposals, reworkClosure, runCreatedTests, runModifiedTests, selectAutoApply, selectQaReworkTargets, verificationCouldNotRun } from './approval';
import { providerOfRef } from '@/types';
import { useMemoryStore } from '@/store/useMemoryStore';
import { juniorsOf, pickModel, suggestMentor } from './team';
import { COMPLEXITIES, COMPLEXITY_HINT, assignAgentModels, assignPlanModels, fallbackForTier, hireModel, isGroupRef, rankModels, routingFor, taskComplexity, type RoutingPolicy } from './modelRouting';
import { BALANCES, activeMagpieGroups, isLowQuota, useMagpieStore } from '@/store/useMagpieStore';
import { useModelWatchStore } from '@/store/useModelWatchStore';
import { DESKTOP_INTERRUPTED, shouldAutoResume } from './runRecovery';
import { interpretChatCommand, expandTaskMentions, parseChatCommand } from './chatCommands';
import { abortableSleep, isTransientError, MAX_TRANSIENT_RETRIES, retryDelayMs } from './retry';
import type { ViewMode } from '@/types';
import { checkLimits, describeLimit, WARN_RATIO, type LimitKind, type LimitReading } from './runLimits';
import { checkBudgetPolicy, computeMonthlyUsage, DEFAULT_BUDGET_POLICY, describeBudget, type BudgetKind } from './budgets';
import { feedbackLessons, isMemoryPath, memoryBrief, noteFeedback, parseLessons, parseRemember, REFLECTION_INSTRUCTIONS, reflectionPrompt, shouldReflect, takeJournal } from './memory';
import { compactToolHistory, computerInstructions, describeComputerAction, formatComputerResult, isComputerAction, MAX_COMPUTER_STEPS, parseComputerRequest } from './computerPolicy';
import type { ComputerTool } from '@/types/computerUse';
import { MAX_PROJECT_TURNS, PROJECT_TOOL_INSTRUCTIONS, isAlreadySatisfiedRework, missingImplementation, parseProjectRequest, readProjectRequest } from './projectTools';
import { usageCounts } from '@/utils/usage';

const MAX_QA_LOOPS = 2;
/** Task-rework rounds caused by a failing verification that the integrator could not repair. Counted apart from QA rejections. */
const MAX_VERIFY_LOOPS = 3;
/** Extra rework rounds granted only when QA finds an evidenced defect the team has never been asked to fix. */
const MAX_NEW_DEFECT_ROUNDS = 2;
/** Rounds in which one integrator fixes the team's combined files against the real verification output. */
const MAX_REPAIR_ROUNDS = 3;
const QA_TASK_ID = 'qa-review';
const TASK_FILE_CONTEXT_CHARS = 36_000;

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

interface RunGuard {
  startedAt: number;
  callsByAgent: Record<string, number>;
  costByAgent: Record<string, number>;
  warned: Set<LimitKind>;
  warnedBudgets: Set<BudgetKind>;
  stopReason: string | null;
  providerLimit?: MissionState['providerLimit'];
  timers: Array<ReturnType<typeof setTimeout>>;
}

let runGuard: RunGuard | null = null;

function limitStopError(reason: string): Error {
  return Object.assign(new Error(`Stopped by run limit: ${reason}`), { name: 'AbortError' });
}

function enforceQuietly(guard: RunGuard) {
  try {
    enforceLimits(guard);
  } catch {
    /* the stop is recorded on the guard and the run controller is aborted */
  }
}

function limitText(r: LimitReading): string {
  return describeLimit(r, r.agentId ? agentsState().agents[r.agentId]?.name : undefined);
}

/** Checks the run's per-run limits and cross-run monthly budgets; warns at 80% and stops the whole run at 100%. */
function enforceLimits(guard: RunGuard) {
  if (guard.stopReason) throw limitStopError(guard.stopReason);
  const { stop, warnings } = checkLimits(agentsState().runLimits, {
    costUSD: runTotals.costUSD,
    tokens: runTotals.promptTokens + runTotals.completionTokens + runTotals.otherTokens,
    elapsedMs: Date.now() - guard.startedAt,
    callsByAgent: guard.callsByAgent,
    costByAgent: guard.costByAgent,
  });
  const runId = currentMission()?.id;
  for (const w of warnings) {
    if (guard.warned.has(w.kind)) continue;
    guard.warned.add(w.kind);
    agentsState().logActivity({ kind: 'run', level: 'warn', runId, text: `Run limit at ${Math.round(w.ratio * 100)}%: ${limitText(w)}` });
  }
  if (stop) {
    stopForLimit(guard, limitText(stop));
    throw limitStopError(guard.stopReason!);
  }
  const monthlyUsage = computeMonthlyUsage(agentsState().runHistory ?? [], {
    id: runId,
    costUSD: runTotals.costUSD,
    tokens: runTotals.promptTokens + runTotals.completionTokens + runTotals.otherTokens,
  });
  const budgetCheck = checkBudgetPolicy(agentsState().budgetPolicy ?? DEFAULT_BUDGET_POLICY, monthlyUsage);
  for (const w of budgetCheck.warnings) {
    if (guard.warnedBudgets.has(w.kind)) continue;
    guard.warnedBudgets.add(w.kind);
    agentsState().logActivity({ kind: 'run', level: 'warn', runId, text: `Monthly budget at ${Math.round(w.ratio * 100)}%: ${describeBudget(w)}` });
  }
  if (budgetCheck.stop) {
    stopForLimit(guard, describeBudget(budgetCheck.stop));
    throw limitStopError(guard.stopReason!);
  }
}

function stopForLimit(guard: RunGuard, reason: string) {
  if (guard.stopReason) return;
  guard.stopReason = reason;
  agentsState().logActivity({ kind: 'run', level: 'error', runId: currentMission()?.id, text: `Run stopped: ${reason}. Raise the limit in Settings → Run limits, then Resume.` });
  runController?.abort();
}

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
  args: { system: string; messages: Array<{ role: 'user' | 'assistant'; content: string }>; signal: AbortSignal; onDelta?: (full: string) => void; note: string; countInRun?: boolean; modelOverride?: string; toolNotice?: string }
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
  const guard = args.countInRun ? runGuard : null;
  const pauseForQuota = (provider: string, resetAt: number, resetKnown: boolean): never => {
    const until = new Date(resetAt).toLocaleString();
    const message = `${provider} usage limit reached. ${resetKnown ? `Resets ${until}` : `Reset time was not supplied; try again after ${until}`}. Finished work is kept. Resume after the limit resets or connect another provider.`;
    if (guard) {
      guard.providerLimit ??= { provider, resetAt, resetKnown };
      runController?.abort();
      throw Object.assign(new Error(message), { name: 'AbortError' });
    }
    throw new Error(message);
  };
  if (guard) {
    enforceLimits(guard);
    guard.callsByAgent[agent.id] = (guard.callsByAgent[agent.id] ?? 0) + 1;
  }
  if (isProviderExhausted(conns().exhausted, providerOfRef(model))) {
    if (!reroute(`${providerOfRef(model)} is out of credit or rate limited`)) {
      const provider = providerOfRef(model)!;
      const previousLimit = currentMission()?.providerLimit;
      pauseForQuota(provider, conns().exhausted[provider], previousLimit?.provider === provider && previousLimit.resetKnown);
    }
  }
  let result: Awaited<ReturnType<typeof streamChat>>;
  let transientRetries = 0;
  for (;;) {
    if (args.signal.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
    let full = '';
    try {
      result = await streamChat({
        model,
        system: `${args.system}\n\n${args.toolNotice ? 'Environment: reply as plain text. You have no built-in provider tools, shell or browser. Use only the host-mediated requests described below.' + args.toolNotice : TEXT_ONLY_NOTICE}`,
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
      if (isAbort(err)) throw err;
      if (!isQuotaError(message)) {
        if (!isTransientError(message) || transientRetries >= MAX_TRANSIENT_RETRIES) throw err;
        transientRetries += 1;
        const delay = retryDelayMs(transientRetries);
        agentsState().logActivity({
          kind: 'info',
          level: 'warn',
          agentId: agent.id,
          text: `${providerOfRef(model)} had a temporary error (${truncate(message, 100)}). Retrying in ${Math.round(delay / 100) / 10}s (${transientRetries} of ${MAX_TRANSIENT_RETRIES}).`,
          model,
        });
        await abortableSleep(delay, args.signal);
        continue;
      }
      const failedProvider = providerOfRef(model);
      const parsedReset = quotaResetAt(message);
      const resetAt = parsedReset ?? Date.now() + EXHAUSTED_COOLDOWN_MS;
      if (failedProvider) conns().markExhausted(failedProvider, resetAt);
      if (!reroute(`${failedProvider} reported: ${truncate(message, 120)}`)) pauseForQuota(failedProvider ?? model, resetAt, parsedReset !== null);
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
    const { prompt, completion, total } = usageCounts(usage);
    runTotals.promptTokens += prompt;
    runTotals.completionTokens += completion;
    runTotals.otherTokens += total - prompt - completion;
    if (cost === null || !usage) runTotals.unpricedTokens += total;
    else runTotals.costUSD += cost;
    if (guard && usage && cost !== null) guard.costByAgent[agent.id] = (guard.costByAgent[agent.id] ?? 0) + cost;
  }
  if (guard) enforceLimits(guard);
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
async function fileContents(paths: string[], budget: number, overrides?: Map<string, string>): Promise<string[]> {
  const ws = useWorkspaceStore.getState();
  const parts: string[] = [];
  let used = 0;
  for (const p of paths) {
    if (used >= budget) {
      parts.push(`--- ${p} ---\n[omitted: context budget reached]`);
      continue;
    }
    let content = overrides?.get(p) ?? ws.buffers[p]?.content;
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
  const changes = currentMission()?.proposedChanges ?? [];
  for (const change of changes) if (change.status === 'pending' || change.status === 'applied') files.add(change.path);
  const references = await fileContents((mission.contextFiles ?? []).filter((path) => files.has(path)), 30_000);
  const dependencyOutputs = mission.tasks.filter((other) => task.dependsOn?.includes(other.id)).map((other) => stripThinking(other.output ?? '')).join('\n');
  const mentioned = selectRelevantFiles(`${task.title}\n${task.description}\n${task.qaFeedback ?? ''}\n${mission.prompt}\n${dependencyOutputs}\n${references.join('\n')}`, [...files], 8);
  const previous = changes.filter((change) => change.taskId === task.id && change.status !== 'discarded').map((change) => change.path);
  const paths = [...new Set([...previous, ...mentioned, ...(mission.contextFiles ?? []).filter((p) => files.has(p))])];
  if (!paths.length) return '';
  const proposed = new Map<string, string>();
  for (const change of [...changes.filter((change) => change.status === 'applied'), ...selectAutoApply(changes, currentMission()?.tasks ?? []).apply]) {
    if (paths.includes(change.path)) proposed.set(change.path, change.content);
  }
  const parts = await fileContents(paths, TASK_FILE_CONTEXT_CHARS, proposed);
  const earlier = proposed.size ? `\n\nThese files already include edits proposed by earlier tasks, so keep those edits: ${[...proposed.keys()].join(', ')}.` : '';
  return `\n\nCurrent contents of relevant files (edit these rather than rewriting from scratch; keep everything you do not intend to change):\n${parts.join('\n\n')}${earlier}`;
}

export async function projectToolReply(parsed: NonNullable<ReturnType<typeof parseProjectRequest>>): Promise<string> {
  if ('error' in parsed) return parsed.error;
  const current = currentMission();
  const changes = current?.proposedChanges ?? [];
  const overrides = new Map<string, string>();
  for (const change of [...changes.filter((change) => change.status === 'applied'), ...selectAutoApply(changes, current?.tasks ?? []).apply]) overrides.set(change.path, change.content);
  const workspace = useWorkspaceStore.getState();
  const files = [...new Set([...workspace.tree.filter((entry) => entry.type === 'file').map((entry) => entry.path), ...overrides.keys()])].filter((path) => !isMemoryPath(path));
  return readProjectRequest(parsed.request, files, async (path) => overrides.get(path) ?? workspace.buffers[path]?.content ?? (await api.readFile(path)).content);
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
Rules: as many tasks as the work needs, each one concrete and independently checkable. When planning changes in an existing project, use project-call first to inspect relevant entry points, storage/data modules, and existing tests so task descriptions reflect actual interfaces, error contracts, and invariants rather than assumptions. Account for every numbered issue, explicit requirement and affected entry point in the request and attached files. Before returning the plan, check that each requirement has an implementing task and a regression check; include the requirement reference and expected behavior in that task's description. Shared library changes alone do not complete requested CLI, API, import or export behavior. Split work so tasks that depend on each other say so in dependsOn (outputs of dependencies are handed to the dependent task). Juniors only get small, well-scoped tasks; their mentor reviews them automatically. Do not add a QA task: QA review by Sentinel runs automatically. Dependencies must reference earlier task ids.
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

function mentionableTasks() {
  const store = agentsState();
  return (currentMission()?.tasks ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    description: t.description,
    assignedAgentId: t.assignedAgentId,
    agentName: store.agents[t.assignedAgentId]?.name,
    error: t.error,
    qaFeedback: t.qaFeedback,
  }));
}

async function runSideChat(args: {
  agent: AgentProfile;
  prompt: string;
  userText: string;
  attachments: string[];
  sideQuestion: boolean;
  speakerId?: string;
  speakerName?: string;
}) {
  const store = agentsState();
  const { agent, prompt, userText, attachments, sideQuestion } = args;
  store.appendChatMessage({
    sender: 'user',
    text: userText,
    mode: 'ask',
    sideQuestion,
    attachedFiles: attachments.length ? attachments : undefined,
  });
  const model = resolveAgentModel(agent, store.roleDefaults);
  const replyId = store.appendChatMessage({
    sender: 'manager',
    text: '',
    mode: 'ask',
    model,
    streaming: true,
    sideQuestion,
    speakerId: args.speakerId ?? agent.id,
    speakerName: args.speakerName ?? agent.name,
  });

  chatController?.abort();
  const controller = new AbortController();
  chatController = controller;

  const expandedPrompt = expandTaskMentions(prompt, mentionableTasks());
  const content = `${expandedPrompt}${await attachmentContext(attachments)}`;
  const lessons = await memoryBrief(agent.id, prompt);
  const specialtyNote = agent.specialty ? `\nSpecialty: ${agent.specialty}` : '';
  const focusNote = agent.focus ? `\nDomain focus: ${agent.focus}` : '';
  const roleLabel = agent.id === 'agent-manager'
    ? ASK_INSTRUCTIONS
    : `Mode: ASK (specialist consultation as ${agent.name}, ${agent.title}). Answer directly from your expertise and inspect project files with project-call if needed. Do not claim to have edited files.`;
  const system = `${agent.systemPrompt}${specialtyNote}${focusNote}${lessons}\n\n${roleLabel}\n\nTeam roster (id | name | title):\n${rosterDescription()}\n\n${projectContext()}`;
  const update = throttle((full) => {
    const t = stripThinking(full).trimStart();
    if (!t.startsWith('```project-call') && !'```project-call'.startsWith(t)) {
      agentsState().updateChatMessage(replyId, { text: full });
    }
  }, 120);

  try {
    const sideMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [{ role: 'user', content }];
    const note = sideQuestion ? 'Side question (/btw)' : `Consult @${agent.name}`;
    let result = await callAgent(agent, {
      system,
      messages: sideMessages,
      signal: controller.signal,
      onDelta: update,
      note,
      toolNotice: PROJECT_TOOL_INSTRUCTIONS,
    });
    let totalUsage = result.usage;
    let totalLatencyMs = result.latencyMs;
    for (let turn = 0; turn < 4; turn++) {
      const parsed = parseProjectRequest(result.text);
      if (!parsed) break;
      sideMessages.push({ role: 'assistant', content: result.text }, { role: 'user', content: await projectToolReply(parsed) });
      compactToolHistory(sideMessages, 4);
      result = await callAgent(agent, {
        system,
        messages: sideMessages,
        signal: controller.signal,
        onDelta: update,
        note,
        toolNotice: PROJECT_TOOL_INSTRUCTIONS,
      });
      totalUsage = mergeChatUsage(totalUsage, result.usage);
      totalLatencyMs += result.latencyMs;
    }
    update.flush();
    agentsState().updateChatMessage(replyId, {
      text: result.text,
      streaming: false,
      usage: totalUsage,
      latencyMs: totalLatencyMs,
      model: result.model,
    });
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

export async function sendToOrchestrator(
  text: string,
  attachments: string[] = [],
  options?: { skipCommands?: boolean; suppressUserEcho?: boolean },
) {
  const store = agentsState();
  const mode = store.orchestratorMode;
  const sovereign = store.agents['agent-manager'];
  if (!sovereign) return;
  const command = options?.skipCommands ? null : parseChatCommand(text, store.customCommands);
  if (command) {
    const workspace = useWorkspaceStore.getState();
    const projectName = (workspace.root || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
    const result = interpretChatCommand(command, {
      mode,
      approval: store.approvalMode,
      strategy: store.teamStrategy,
      running: store.isLiveRunning,
      sovereignModel: resolveAgentModel(sovereign, store.roleDefaults) ?? '',
      agents: store.agents,
      availableModels: availableModels().map((m) => ({ ref: m.ref, label: m.name })),
      customCommands: store.customCommands,
      activeFile: workspace.activePath ?? '',
      projectName,
    });
    const handledBySideChat = result.actions.some((a) => a.type === 'btw' || a.type === 'consult');
    if (command.name !== 'clear' && command.name !== 'new' && !handledBySideChat) {
      store.appendChatMessage({ sender: 'user', text, mode, attachedFiles: attachments.length ? attachments : undefined });
    }
    for (const action of result.actions) {
      if (action.type === 'mode') store.setOrchestratorMode(action.mode);
      else if (action.type === 'approval') store.setApprovalMode(action.mode);
      else if (action.type === 'strategy') store.setTeamStrategy(action.strategy);
      else if (action.type === 'model') store.reassignModel(action.agentId, action.model);
      else if (action.type === 'clear') {
        chatController?.abort();
        store.clearChat();
      } else if (action.type === 'stop') {
        chatController?.abort();
        stopRun();
      } else if (action.type === 'resume') void resumeRun();
      else if (action.type === 'open') store.setActiveView(action.view as ViewMode);
      else if (action.type === 'btw') {
        await runSideChat({ agent: sovereign, prompt: action.prompt, userText: text, attachments, sideQuestion: true });
        return;
      } else if (action.type === 'consult') {
        const specialist = store.agents[action.agentId];
        if (specialist) {
          await runSideChat({
            agent: specialist,
            prompt: action.prompt,
            userText: text,
            attachments,
            sideQuestion: false,
            speakerId: specialist.id,
            speakerName: specialist.name,
          });
          return;
        }
      }
    }
    const message = result.error ?? result.reply;
    if (message) agentsState().appendChatMessage({ sender: 'system', text: message });
    if (result.prompt) return sendToOrchestrator(result.prompt, attachments, { skipCommands: true, suppressUserEcho: true });
    return;
  }
  const remember = options?.skipCommands ? null : parseRemember(text, store.agents);
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

  const sourceMessages = options?.suppressUserEcho && store.managerChatMessages.at(-1)?.sender === 'user'
    ? store.managerChatMessages.slice(0, -1)
    : store.managerChatMessages;
  const history = sourceMessages
    .filter((m) => (m.sender === 'user' || m.sender === 'manager') && !m.error && !m.streaming && m.text && !m.sideQuestion)
    .slice(-16)
    .map((m) => ({
      role: (m.sender === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.plan
        ? `[Proposed plan] ${m.plan.summary}`
        : m.sender === 'manager' && m.speakerName && m.speakerId && m.speakerId !== 'agent-manager'
          ? `[${m.speakerName}]: ${m.text}`
          : m.text,
    }));

  if (!options?.suppressUserEcho) store.appendChatMessage({ sender: 'user', text, mode, attachedFiles: attachments.length ? attachments : undefined });
  const model = resolveAgentModel(sovereign, store.roleDefaults);
  const replyId = store.appendChatMessage({ sender: 'manager', text: '', mode, model, streaming: true });

  chatController?.abort();
  const controller = new AbortController();
  chatController = controller;

  if (mode !== 'ask' && useMagpieStore.getState().enabled) await useMagpieStore.getState().loadQuotas(true);
  const content = `${expandTaskMentions(text, mentionableTasks())}${await attachmentContext(attachments)}`;
  const lessons = await memoryBrief(sovereign.id, text);
  const system = `${sovereign.systemPrompt}${lessons}\n\n${mode === 'ask' ? ASK_INSTRUCTIONS : planInstructions(store.teamStrategy, store.complexityRouting)}\n\nTeam roster (id | name | title):\n${rosterDescription()}\n\n${mode === 'ask' ? '' : modelCatalog() + '\n\n'}${projectContext()}`;
  const update = throttle((full) => {
    const t = stripThinking(full).trimStart();
    if (!t.startsWith('```project-call') && !'```project-call'.startsWith(t)) {
      agentsState().updateChatMessage(replyId, { text: full });
    }
  }, 120);

  try {
    const planMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [...history, { role: 'user', content }];
    const toolNotice = mode === 'ask' ? undefined : PROJECT_TOOL_INSTRUCTIONS;
    let result = await callAgent(sovereign, {
      system,
      messages: planMessages,
      signal: controller.signal,
      onDelta: update,
      note: `Chat (${mode})`,
      toolNotice,
    });
    let totalUsage = result.usage;
    let totalLatencyMs = result.latencyMs;
    if (mode !== 'ask') {
      for (let turn = 0; turn < 6; turn++) {
        const parsed = parseProjectRequest(result.text);
        if (!parsed) break;
        planMessages.push({ role: 'assistant', content: result.text }, { role: 'user', content: await projectToolReply(parsed) });
        compactToolHistory(planMessages, 4);
        result = await callAgent(sovereign, {
          system,
          messages: planMessages,
          signal: controller.signal,
          onDelta: update,
          note: `Chat (${mode})`,
          toolNotice,
        });
        totalUsage = mergeChatUsage(totalUsage, result.usage);
        totalLatencyMs += result.latencyMs;
      }
    }
    update.flush();
    const patch: Partial<ManagerChatMessage> = {
      text: result.text,
      streaming: false,
      usage: totalUsage,
      latencyMs: totalLatencyMs,
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
  const newAgents = plan.newAgents?.map((agent) => ({
    ...agent,
    model: hireModel(agent, allowed, policy, store.complexityRouting ? tiers : {}),
  }));
  if (!store.complexityRouting) return { ...plan, newAgents, tasks: assignAgentModels(plan.tasks, allowed, policy) };
  const juniorKeys = new Set((plan.newAgents ?? []).filter((n) => n.junior).map((n) => n.key));
  return {
    ...plan,
    newAgents,
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

async function desktopTools(runId: string): Promise<ComputerTool[]> {
  try {
    const tools = (await api.computerTools())?.tools;
    return Array.isArray(tools) ? tools : [];
  } catch (err) {
    agentsState().logActivity({ kind: 'info', level: 'warn', runId, text: `Desktop tools are unavailable for this task: ${truncate((err as Error).message, 160)}` });
    return [];
  }
}

function mergeChatUsage(prev?: ChatUsage, next?: ChatUsage): ChatUsage | undefined {
  if (!prev) return next;
  if (!next) return prev;
  const add = (a?: number, b?: number) => (a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0));
  return {
    inputTokens: add(prev.inputTokens, next.inputTokens),
    outputTokens: add(prev.outputTokens, next.outputTokens),
    totalTokens: add(prev.totalTokens, next.totalTokens),
    cacheReadTokens: add(prev.cacheReadTokens, next.cacheReadTokens),
    cacheWriteTokens: add(prev.cacheWriteTokens, next.cacheWriteTokens),
    cacheWrite1hTokens: add(prev.cacheWrite1hTokens, next.cacheWrite1hTokens),
  };
}

function usageTokens(usage?: ChatUsage): number {
  return usageCounts(usage).total;
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
  store.updateTask(task.id, { status: 'in_progress', progress: 10, startedAt: started, error: undefined, worktreePath: undefined, attempts });
  store.updateMission({ currentStage: task.stage, stageIndex: ['briefing', 'architecture', 'implementation'].indexOf(task.stage) });
  store.setAgentStatus(agent.id, agent.role === 'architect' || agent.role === 'manager' ? 'thinking' : 'coding', task.title, null);
  store.logActivity({ kind: 'step_started', level: 'info', runId: mission.id, agentId: agent.id, taskId: task.id, text: `${agent.name} started "${task.title}"` });

  const depOutputs = (task.dependsOn ?? [])
    .map((d) => taskById(d))
    .filter((d): d is KanbanTaskCard => Boolean(d?.output))
    .map((d) => `### Output of "${d.title}" (${store.agents[d.assignedAgentId]?.name})\n${d.stage === 'implementation' ? compactFileOutputs(d.output!, 4_000) : truncate(stripThinking(d.output!), 6_000)}`)
    .join('\n\n');

  const system = `${agent.systemPrompt}
${agent.specialty ? `\nYour specialty is ${agent.specialty}.` : ''}
${agent.focus ? `\nYour domain instructions: ${agent.focus}` : ''}

You are executing one task of a larger plan coordinated by Sovereign.
When you create or change files, output each file in full inside a fenced block whose info string contains path=<relative path>, e.g.:
\`\`\`ts path=src/example.ts
// full file content
\`\`\`
Agent HQ extracts your path= file blocks and writes them to the project automatically, even if your underlying CLI sandbox is read-only. Never say you cannot write files or ask for write tools. Files are applied to the project after verification/QA approves the run. Keep explanations short.
When updating existing entry points (CLI commands, HTTP routes, or handlers), inspect sibling handlers in the same module so input bounds, error reporting, exit/status codes, and output formatting stay consistent. Check data-layer scope invariants (such as per-parent vs global counters or keys) and worst-case runtime complexity against stated input bounds.
When adding new tests, create a new test file rather than editing pre-existing test files unless the task explicitly requires changing an existing test file.
When you change an existing file, start from its current contents (provided below when available) and preserve unrelated code.${await memoryBrief(agent.id, `${task.title}\n${task.description}\n${task.qaFeedback ?? ''}`)}`;

  const hasPriorChange = (currentMission()?.proposedChanges ?? []).some((c) => c.taskId === task.id && (c.status === 'pending' || c.status === 'applied'));
  const fileContext = await taskFileContext(task, mission);
  const user = `Overall request:\n${mission.prompt}\n\nYour task: ${task.title}\n${task.description}${
    task.qaFeedback ? `\n\nQA feedback to address (this task was rejected):\n${task.qaFeedback}${hasPriorChange ? '\n\nIf you inspect the current files and confirm your previous changes already satisfy every point above with zero code edits needed, start your reply with ALREADY_SATISFIED: followed by a brief proof instead of emitting redundant or empty file blocks.' : ''}` : ''
  }${depOutputs ? `\n\nResults from tasks you depend on:\n${depOutputs}` : ''}${fileContext}\n\n${projectContext()}`;

  const update = throttle((full) => agentsState().updateTask(task.id, { output: full, progress: Math.min(90, 10 + Math.floor(full.length / 80)) }), 250);
  try {
    const tools = await desktopTools(mission.id);
    const toolNotice = PROJECT_TOOL_INSTRUCTIONS + (tools.length ? computerInstructions(tools, task.computerLog) : '');
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [{ role: 'user', content: user }];
    const ask = (note: string) => callAgent(agent, { system, messages, signal, onDelta: update, note, countInRun: true, modelOverride: task.model, toolNotice });
    let result = await ask(`Task: ${task.title}`);
    let tokens = usageTokens(result.usage);
    let projectTurns = 0;
    let desktopTurns = 0;
    let desktopReads = 0;
    let requestedDeliverable = false;
    for (;;) {
      const project = parseProjectRequest(result.text);
      if (project) {
        if (++projectTurns > MAX_PROJECT_TURNS) throw new Error(`Used all ${MAX_PROJECT_TURNS} project read turns without finishing.`);
        const reply = await projectToolReply(project);
        if ('request' in project) {
          store.logActivity({ kind: 'info', level: 'info', runId: mission.id, taskId: task.id, agentId: agent.id, text: `${agent.name} requested project context: ${project.request.name}${project.request.name === 'read_files' ? ` (${project.request.paths.join(', ')})` : ''}` });
        }
        messages.push({ role: 'assistant', content: result.text }, { role: 'user', content: reply });
        compactToolHistory(messages, 4);
        result = await ask(`Task: ${task.title} (project read ${projectTurns})`);
        tokens += usageTokens(result.usage);
        continue;
      }
      const parsed = parseComputerRequest(result.text);
      if (!parsed) {
        const cleanText = stripThinking(result.text);
        const fileCount = extractFileBlocks(result.text).filter((file) => !isMemoryPath(file.path)).length;
        if (isAlreadySatisfiedRework(cleanText, hasPriorChange) || !missingImplementation(task.stage, fileCount, desktopReads)) break;
        if (requestedDeliverable) throw new Error('Implementation returned no file changes. The task is blocked, not completed. Read the needed source with project-call and retry.');
        requestedDeliverable = true;
        const reworkHint = hasPriorChange
          ? ' If your existing changes already satisfy the QA feedback with no edits needed, start your reply with ALREADY_SATISFIED: and explain why.'
          : '';
        messages.push({ role: 'assistant', content: result.text }, { role: 'user', content: `No implementation was delivered. Read missing source with project-call, then return complete path= file blocks.${reworkHint} Agent HQ writes your path= blocks itself even if your CLI sandbox is read-only. A description, request for context, or reporting a read-only workspace does not complete the task.` });
        result = await ask(`Task: ${task.title} (missing deliverable)`);
        tokens += usageTokens(result.usage);
        continue;
      }
      if (!tools.length) throw new Error('Desktop tools are not enabled. Use project-call to read project files.');
      if (++desktopTurns > MAX_COMPUTER_STEPS) throw new Error(`Used all ${MAX_COMPUTER_STEPS} desktop tool turns without finishing.`);
      let reply: string;
      if ('error' in parsed) {
        reply = parsed.error;
      } else {
        const { request } = parsed;
        if (isComputerAction(request.name)) {
          const done = taskById(task.id);
          const entry = describeComputerAction(request);
          agentsState().updateTask(task.id, { computerActions: (done?.computerActions ?? 0) + 1, computerLog: [...(done?.computerLog ?? []), entry].slice(-40) });
          agentsState().logActivity({ kind: 'info', level: 'info', runId: mission.id, agentId: agent.id, taskId: task.id, text: `${agent.name} used the desktop: ${entry}` });
        }
        try {
          reply = formatComputerResult(request.name, (await api.computerCall(request.name, request.arguments, signal)).result);
          desktopReads++;
        } catch (err) {
          if (isAbort(err)) throw err;
          reply = `Error from ${request.name}: ${(err as Error).message}`;
        }
      }
      messages.push({ role: 'assistant', content: result.text }, { role: 'user', content: reply });
      compactToolHistory(messages);
      result = await ask(`Task: ${task.title} (desktop step ${desktopTurns})`);
      tokens += usageTokens(result.usage);
    }
    servedByTask.set(task.id, result.model);
    update.flush();
    let output = result.text;

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
            content: `Task: ${task.title}\n${task.description}\n\nJunior output from ${agent.name}:\n${truncate(stripThinking(output), 16000)}\n\nYou cannot run commands or open other files in this review. Do not choose REVISE only because something is unverified; REVISE only for a defect you can see in the output above, and then include the complete corrected file blocks.\n\nReply in this exact format:\nVERDICT: APPROVE or REVISE\nNOTES: <short review notes>\nREVISED OUTPUT:\n<only if REVISE: the full corrected output, including complete file blocks>`,
          },
        ],
        signal,
        note: `N+1 review of ${agent.name}: ${task.title}`,
        countInRun: true,
      });
      tokens += usageTokens(review.usage);
      const verdict = parseMentorVerdict(review.text);
      if (verdict.verdict === 'revise') output = adoptMentorRevision(output, verdict.revised);
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

    const blocks = extractFileBlocks(output);
    let files = blocks.filter((f) => !isMemoryPath(f.path));
    if (files.length < blocks.length) {
      agentsState().logActivity({ kind: 'learning', level: 'warn', runId: mission.id, agentId: agent.id, taskId: task.id, text: `${agent.name} tried to edit the project memory folder; those file changes were dropped` });
    }
    const keptPriorRework = files.length === 0 && isAlreadySatisfiedRework(stripThinking(output), hasPriorChange);
    if (!keptPriorRework && missingImplementation(task.stage, files.length, desktopReads)) throw new Error('The reviewed implementation contains no file deliverable.');
    if (files.length) {
      const base = new Map<string, { path: string; content: string }>();
      for (const change of currentMission()?.proposedChanges ?? []) {
        if (change.status === 'applied' || change.status === 'pending') base.set(change.path, { path: change.path, content: change.content });
      }
      for (const file of files) base.set(file.path, file);
      let isolated = await api.stageWorker(mission.id, task.id, attempts, [...base.values()]);
      store.updateTask(task.id, { worktreePath: isolated.path });
      store.logActivity({ kind: 'info', level: 'info', runId: mission.id, taskId: task.id, text: isolated.kind === 'worktree' ? `Preserved ${task.title} in an isolated Git worktree: ${isolated.path}` : isolated.reason ?? 'Changes remain proposals.' });

      const verifyCmd = agentsState().verificationCommand.trim();
      if (isolated.kind === 'worktree' && isolated.path && verifyCmd) {
        let check: Awaited<ReturnType<typeof api.verifyWorker>> | null = null;
        try {
          check = await api.verifyWorker(isolated.path, verifyCmd, 60_000);
        } catch {
          check = null;
        }
        const checkOut = check ? `${check.stdout ?? ''}\n${check.stderr ?? ''}`.trim() : '';
        const touchesOwnFiles = files.some((f) => {
          const baseName = f.path.slice(f.path.lastIndexOf('/') + 1);
          return checkOut.includes(f.path) || (baseName.length >= 4 && checkOut.includes(baseName));
        });
        if (check && !check.rejected && check.exitCode !== 0 && !verificationCouldNotRun(check.exitCode, checkOut) && touchesOwnFiles) {
          store.logActivity({ kind: 'verification', level: 'warn', runId: mission.id, agentId: agent.id, taskId: task.id, text: `Isolated worktree verification caught a failure in ${agent.name}'s files for "${task.title}" (exit ${check.exitCode}); running 1 self-repair turn.` });
          messages.push(
            { role: 'assistant', content: output },
            { role: 'user', content: `Isolated worktree verification ran "${verifyCmd}" on your proposed files and failed (exit ${check.exitCode}):\n\n${checkOut.slice(-4000)}\n\nFix the defect in your files and return complete path= file blocks (only files you change).` },
          );
          compactToolHistory(messages, 4);
          let repaired = await ask(`Task: ${task.title} (worktree self-repair)`);
          tokens += usageTokens(repaired.usage);
          for (let rt = 0; rt < 2; rt++) {
            const rp = parseProjectRequest(repaired.text);
            if (!rp) break;
            messages.push({ role: 'assistant', content: repaired.text }, { role: 'user', content: await projectToolReply(rp) });
            compactToolHistory(messages, 4);
            repaired = await ask(`Task: ${task.title} (worktree self-repair read ${rt + 1})`);
            tokens += usageTokens(repaired.usage);
          }
          const repairedFiles = extractFileBlocks(repaired.text).filter((f) => !isMemoryPath(f.path));
          if (repairedFiles.length) {
            output = repaired.text;
            const merged = new Map(files.map((f) => [f.path, f]));
            for (const rf of repairedFiles) {
              merged.set(rf.path, rf);
              base.set(rf.path, rf);
            }
            files = [...merged.values()];
            try {
              isolated = await api.stageWorker(mission.id, `${task.id}-repair`, attempts, [...base.values()]);
              store.updateTask(task.id, { worktreePath: isolated.path });
            } catch {
              // Keep the initial staged worktree path if re-staging repair fails.
            }
          }
        }
      }

      const changes: ProposedFileChange[] = files.map((f) => ({
        id: `${task.id}:${f.path}:${crypto.randomUUID()}`,
        path: f.path,
        content: f.content,
        taskId: task.id,
        agentId: agent.id,
        status: 'pending',
      }));
      const existing = (currentMission()?.proposedChanges ?? []).filter((c) => c.taskId !== task.id || c.status === 'applied');
      const marked = markConflicts([...existing, ...changes], currentMission()?.tasks ?? []);
      agentsState().updateMission({ proposedChanges: marked });
      for (const c of marked) {
        if (c.taskId !== task.id || !c.conflictsWith?.length) continue;
        const names = c.conflictsWith.map((id) => `"${taskById(id)?.title ?? id}"`).join(', ');
        const next = autoAppliesChanges(store.approvalMode) ? 'The integrator will combine these proposals before QA.' : 'Review both proposals in the Changes tab before applying a version.';
        agentsState().logActivity({ kind: 'info', level: 'warn', runId: mission.id, agentId: agent.id, taskId: task.id, text: `Conflict: ${agent.name} and ${names} both changed ${c.path} independently. ${next}` });
      }
    }
    const durationMs = Date.now() - started;
    agentsState().updateTask(task.id, {
      status: 'completed',
      progress: 100,
      output,
      tokens: (task.tokens ?? 0) + tokens,
      durationMs,
      completedAt: Date.now(),
      model: result.model,
      tags: files.length ? [`${files.length} file${files.length > 1 ? 's' : ''}`] : keptPriorRework ? ['kept prior changes'] : [],
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
      text: `${agent.name} finished "${task.title}"${files.length ? ` — ${files.length} file change(s) proposed` : keptPriorRework ? ' — verified prior changes need no edits' : ''}`,
    });
  } catch (err) {
    update.flush();
    const durationMs = Date.now() - started;
    const aborted = isAbort(err);
    const desktopInterrupted = !!taskById(task.id)?.computerActions;
    agentsState().updateTask(task.id, {
      status: aborted && !desktopInterrupted ? 'pending' : 'failed',
      error: desktopInterrupted ? DESKTOP_INTERRUPTED : aborted ? 'Stopped before completion.' : (err as Error).message,
      computerNeedsReview: desktopInterrupted || undefined,
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

async function verifyNow(command: string) {
  const res = await useWorkspaceStore.getState().runCommand(command);
  const raw = `${res.stdout ?? ''}\n${res.stderr ?? ''}`.trim();
  const verification = { command, exitCode: res.exitCode ?? null, output: truncate(raw, 20_000), durationMs: res.durationMs ?? 0, ranAt: Date.now() };
  agentsState().updateMission({ verification });
  const passed = res.exitCode === 0;
  const unrunnable = !passed && (!!res.rejected || verificationCouldNotRun(res.exitCode ?? null, raw));
  const why = res.rejected ? String(res.stderr) : raw.split('\n').find((line) => line.trim()) ?? `exit ${res.exitCode}`;
  return { passed, unrunnable, raw, why, verification, exitCode: res.exitCode };
}

type Verified = Awaited<ReturnType<typeof verifyNow>>;

const MAX_MERGE_ROUNDS = 2;

async function mergeConflictingChanges(signal: AbortSignal): Promise<{ merged: string[]; unresolved: string[] }> {
  const store = agentsState();
  const mission = currentMission();
  const merged: string[] = [];
  const unresolved: string[] = [];
  if (!mission) return { merged, unresolved };
  const clashing = new Map<string, ProposedFileChange[]>();
  for (const change of selectAutoApply(mission.proposedChanges ?? [], mission.tasks).conflicted) {
    clashing.set(change.path, [...(clashing.get(change.path) ?? []), change]);
  }
  if (!clashing.size) return { merged, unresolved };
  const integrator = store.agents['agent-architect'] ?? store.agents['agent-manager'];
  if (!integrator) return { merged, unresolved: [...clashing.keys()] };
  const workTasks = mission.tasks.filter((t) => t.id !== QA_TASK_ID);
  const modelOverride = workTasks.find((t) => t.complexity === 'complex' && t.model)?.model ?? workTasks.find((t) => t.model)?.model;
  store.setAgentStatus(integrator.id, 'coding', 'Merging files changed by several tasks');
  try {
    for (const [path, versions] of clashing) {
      signal.throwIfAborted();
      const base = await api.readFileIfExists(path);
      const titleOf = (taskId: string) => mission.tasks.find((t) => t.id === taskId)?.title ?? taskId;
      store.logActivity({ kind: 'info', level: 'info', runId: mission.id, agentId: integrator.id, text: `${integrator.name} is merging ${versions.length} versions of ${path} written by separate tasks` });
      let content: string | undefined;
      if (versions.some((version) => version.content.length > 60_000) || (base?.content?.length ?? 0) > 60_000) {
        unresolved.push(path);
        continue;
      }
      const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [{
        role: 'user',
        content: `Request:\n${mission.prompt}${await attachmentContext(mission.contextFiles)}\n\nCurrent file on disk:\n${base?.content ?? '(does not exist yet)'}\n\n${versions.map((v, index) => `VERSION ${index + 1} — from task "${titleOf(v.taskId)}":\n${v.content}`).join('\n\n')}`,
      }];
      for (let round = 1; round <= MAX_MERGE_ROUNDS && content === undefined; round++) {
        const result = await callAgent(integrator, {
          system: `${integrator.systemPrompt}\n\nYou are the integrator. Several engineers changed the same file independently, each without seeing the others' work. Produce ONE version of the file that contains every change from every version: all new functions, flags, options, fields and fixes. Where two versions changed the same lines, combine them so both behaviours still hold. Keep unrelated existing code as it is. Do not drop a change because another version looks similar.\nOutput the complete merged file in one fenced block whose info string contains path=${path}, and nothing else of substance.`,
          messages,
          signal,
          note: `Merge ${path}, round ${round}`,
          countInRun: true,
          modelOverride,
        });
        const blocks = extractFileBlocks(result.text);
        if (blocks.length === 1 && blocks[0].path === path && blocks[0].content.trim()) {
          content = blocks[0].content;
        } else {
          messages.push({ role: 'assistant', content: result.text }, { role: 'user', content: `The merge was not accepted: return exactly one complete, nonempty file block with path=${path}. Both original proposals remain unchanged.` });
        }
      }
      if (content === undefined) {
        unresolved.push(path);
        store.logActivity({ kind: 'info', level: 'warn', runId: mission.id, agentId: integrator.id, text: `${integrator.name} could not produce a merged ${path}` });
        continue;
      }
      const keep = versions[0];
      const mergedChange: ProposedFileChange = {
        id: `merge:${path}:${crypto.randomUUID()}`, path, content, taskId: keep.taskId, agentId: integrator.id,
        sourceTaskIds: [...new Set(versions.flatMap((version) => [version.taskId, ...(version.sourceTaskIds ?? [])]))],
        status: 'pending',
      };
      await api.stageWorker(mission.id, `merge-${crypto.randomUUID()}`, 1, [{ path, content }]);
      store.updateMission({
        proposedChanges: replaceMergedProposals(currentMission()?.proposedChanges ?? [], versions, mergedChange),
      });
      merged.push(path);
      store.logActivity({ kind: 'info', level: 'success', runId: mission.id, agentId: integrator.id, text: `Merged ${versions.length} versions of ${path} into one` });
    }
  } finally {
    store.setAgentStatus(integrator.id, 'idle');
  }
  return { merged, unresolved };
}

/** Project files a failure output names, read from disk, that are not already among the written changes. */
async function filesNamedIn(output: string, skip: Set<string>, limit = 10): Promise<Array<{ path: string; content: string }>> {
  const tree = useWorkspaceStore.getState().tree.filter((entry) => entry.type === 'file' && !skip.has(entry.path)).map((entry) => entry.path);
  const named = tree.filter((path) => output.includes(path)).slice(0, limit);
  const files = await Promise.all(named.map(async (path) => ({ path, content: (await api.readFileIfExists(path))?.content ?? null })));
  return files.filter((file): file is { path: string; content: string } => typeof file.content === 'string');
}

/**
 * When the team's combined files fail verification, one integrator sees all of them with the real output and returns
 * corrected files, which are written and verified again. This is the edit-and-test loop a single coding agent runs,
 * and it fixes the cross-task mismatches that per-task rework cannot see. Returns the repairs that made it pass, or
 * undoes them and returns null.
 */
async function repairIntegration(command: string, failure: Verified, signal: AbortSignal): Promise<{ result: Verified; added: string[] } | null> {
  const store = agentsState();
  const mission = currentMission()!;
  const integrator = store.agents['agent-architect'] ?? store.agents['agent-manager'];
  if (!integrator) return null;
  const workTasks = mission.tasks.filter((t) => t.id !== QA_TASK_ID);
  const modelOverride = workTasks.find((t) => t.complexity === 'complex' && t.model)?.model ?? workTasks.find((t) => t.model)?.model;
  const added: string[] = [];
  const repairIds: string[] = [];
  let keepRepairs = false;
  let last = failure;
  store.setAgentStatus(integrator.id, 'coding', 'Integrating the team\'s changes');
  try {
    for (let round = 1; round <= MAX_REPAIR_ROUNDS; round++) {
      const applied = new Map<string, ProposedFileChange>();
      for (const change of currentMission()?.proposedChanges ?? []) if (change.status === 'applied') applied.set(change.path, change);
      const related = await filesNamedIn(last.raw, new Set(applied.keys()));
      const written = [...applied.values()].map((c) => `FILE ${c.path} (written by ${c.taskId})\n${c.content}`).join('\n\n');
      const ownTests = runCreatedTests(currentMission()?.proposedChanges ?? []);
      const modifiedTests = runModifiedTests(currentMission()?.proposedChanges ?? []);
      const modTestNote = modifiedTests.length
        ? `\n\nExisting test files modified by the team during this run (${modifiedTests.join(', ')}): keep every pre-existing test in them intact, while any new test assertions added during this run are held to the requirements and may be corrected (or moved into a new test file) if wrong.`
        : '';
      const testNote = (ownTests.length
        ? `\n\nTests created by the team during this run (not part of the original project): ${ownTests.join(', ')}. These are part of the candidate and may be wrong. If one contradicts the request or the attached requirements, correct that test and state the requirement it contradicted. Tests that existed before this run are the project's contract and stay protected.`
        : '') + modTestNote;
      store.logActivity({ kind: 'verification', level: 'info', runId: mission.id, agentId: integrator.id, text: `${integrator.name} is fixing the combined changes against the verification output (round ${round} of ${MAX_REPAIR_ROUNDS})` });
      const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [{
        role: 'user',
        content: `Request:\n${mission.prompt}${await attachmentContext(mission.contextFiles)}\n\nVerification command: ${command} (exit ${last.exitCode})\nOutput (end):\n${last.raw.slice(-12_000)}\n\nFiles the team wrote:\n${truncate(written, 140_000)}${
          related.length ? `\n\nOther project files named in the output:\n${truncate(related.map((file) => `FILE ${file.path}\n${file.content}`).join('\n\n'), 40_000)}` : ''}${testNote}\n\n${projectContext()}`,
      }];
      const ask = () => callAgent(integrator, {
        system: `${integrator.systemPrompt}\n\nYou are the integrator. Several engineers each wrote part of the change below, and their files are now in the project together. The verification command fails. Find why from the real output and fix the code so it passes while still meeting the request. Usually the cause is a mismatch between files (signatures, names, data formats) or one missing piece.\nRules: never delete, skip or weaken tests that existed before this run to make them pass; fix the code. A test the team created during this run is held to the requirements, not the other way round: when it asserts behaviour the requirements contradict, correct the test. Keep every behaviour the request asks for. Add a focused regression test for any defect that is not already covered by the failing tests. Output each file you change in full in a fenced block whose info string contains path=<relative path>, and only the files you change. You must output at least one file; asking the user is not possible during a run. Keep explanations to a few lines.`,
        messages,
        signal,
        note: `Integration repair, round ${round}`,
        countInRun: true,
        modelOverride,
        toolNotice: PROJECT_TOOL_INSTRUCTIONS,
      });
      let result = await ask();
      for (let turn = 0; ; turn++) {
        const parsed = parseProjectRequest(result.text);
        if (!parsed) break;
        if (turn >= MAX_PROJECT_TURNS) throw new Error('Integration exhausted its project read turns.');
        messages.push({ role: 'assistant', content: result.text }, { role: 'user', content: await projectToolReply(parsed) });
        compactToolHistory(messages, 4);
        result = await ask();
      }
      const blocks = extractFileBlocks(result.text).filter((file) => !isMemoryPath(file.path));
      if (!blocks.length) {
        if (round < MAX_REPAIR_ROUNDS) {
          last = { ...last, raw: `${last.raw}\n\nYour previous answer changed no files:\n${truncate(stripThinking(result.text), 3_000)}\nNo one can answer questions during the run. Decide from the request and the attached requirements, and output the corrected files.` };
          continue;
        }
        break;
      }
      const fallbackTask = blameTasks(last.raw, currentMission()?.proposedChanges ?? [], workTasks)[0]?.id ?? workTasks[0].id;
      const repairs: ProposedFileChange[] = blocks.map((file) => ({
        id: `integration:${file.path}:${crypto.randomUUID()}`,
        path: file.path,
        content: file.content,
        taskId: applied.get(file.path)?.taskId ?? fallbackTask,
        agentId: integrator.id,
        status: 'pending',
      }));
      const preserved = await api.stageWorker(mission.id, `integration-${mission.qaRejectCount ?? 0}`, round, [
        ...[...applied.values()].map(({ path, content }) => ({ path, content })),
        ...blocks,
      ]);
      store.logActivity({ kind: 'verification', level: 'info', runId: mission.id, text: preserved.path ? `Integration round ${round} recovery copy: ${preserved.path}` : preserved.reason ?? 'Integration changes are retained as proposals.' });
      store.updateMission({ proposedChanges: [...(currentMission()?.proposedChanges ?? []), ...repairs] });
      repairIds.push(...repairs.map((repair) => repair.id));
      const outcome = await autoApplyChanges();
      const ids = new Set(repairs.map((r) => r.id));
      added.push(...(currentMission()?.proposedChanges ?? []).filter((c) => ids.has(c.id) && c.status === 'applied').map((c) => c.id));
      if (outcome.failed) break;
      last = await verifyNow(command);
      store.logActivity({ kind: 'verification', level: last.passed ? 'success' : 'error', runId: mission.id, agentId: integrator.id, text: `Verification ${last.passed ? 'passed' : `failed (exit ${last.exitCode})`} after ${integrator.name}'s round ${round} (${repairs.length} file${repairs.length === 1 ? '' : 's'})` });
      if (last.passed) {
        keepRepairs = true;
        return { result: last, added };
      }
      if (last.unrunnable) break;
    }
    return null;
  } finally {
    if (!keepRepairs) {
      for (const id of [...repairIds].reverse()) {
        await revertProposedChange(id);
        store.setProposedChangeStatus(id, 'discarded');
      }
    }
    store.setAgentStatus(integrator.id, 'idle');
  }
}

async function runQa(signal: AbortSignal): Promise<'approved' | 'rejected' | 'retry' | 'retained'> {
  const store = agentsState();
  const mission = currentMission()!;
  const qa = store.agents['agent-qa'];
  const workTasks = mission.tasks.filter((t) => t.id !== QA_TASK_ID);
  const started = Date.now();
  store.updateTask(QA_TASK_ID, { status: 'in_progress', progress: 20, startedAt: started, error: undefined });
  store.updateMission({ currentStage: 'qa_review', stageIndex: 3 });
  store.setAgentStatus(qa.id, 'reviewing', 'QA & security review');
  store.logActivity({ kind: 'qa', level: 'info', runId: mission.id, agentId: qa.id, text: 'Sentinel started QA review' });

  const command = store.verificationCommand.trim();
  const mergeOutcome = autoAppliesChanges(store.approvalMode) ? await mergeConflictingChanges(signal) : { unresolved: [] };
  if (mergeOutcome.unresolved.length) throw new Error(`Cannot review the candidate: could not merge ${mergeOutcome.unresolved.join(', ')}. The original proposals are preserved.`);
  let candidateApplied: string[] = [];
  let verificationNote = '';
  let verified = false;
  if (command && !autoAppliesChanges(store.approvalMode)) {
    store.logActivity({ kind: 'verification', level: 'info', runId: mission.id, text: `Verification "${command}" was not run: in manual approval nothing is written until you apply it, so it would test the old code. Run it after applying.` });
  }
  if (command && autoAppliesChanges(store.approvalMode)) {
    const pendingBefore = new Set((currentMission()?.proposedChanges ?? []).filter((c) => c.status === 'pending').map((c) => c.id));
    const written = await autoApplyChanges();
    if (written.failed || currentMission()?.proposedChanges?.some((change) => change.status === 'pending')) {
      const left = mergeOutcome.unresolved.length ? ` Could not merge: ${mergeOutcome.unresolved.join(', ')}.` : '';
      throw new Error(`Verification cannot certify this candidate: some proposed files could not be written or have unresolved conflicts.${left}`);
    }
    candidateApplied = (currentMission()?.proposedChanges ?? []).filter((c) => c.status === 'applied' && pendingBefore.has(c.id)).map((c) => c.id);
    store.logActivity({ kind: 'verification', level: 'info', runId: mission.id, text: `Running verification on the proposed changes: ${command}` });
    let check = await verifyNow(command);
    const firstFailure = check;
    store.logActivity({
      kind: 'verification',
      level: check.unrunnable ? 'warn' : check.passed ? 'success' : 'error',
      runId: mission.id,
      text: check.unrunnable ? `Verification could not run, so it says nothing about the code: ${check.why}` : `Verification ${check.passed ? 'passed' : `failed (exit ${check.exitCode})`}`,
    });
    if (check.unrunnable) {
      store.setAgentStatus(qa.id, 'idle');
      store.updateTask(QA_TASK_ID, { status: 'pending', progress: 0 });
      throw new Error(`Verification "${command}" could not run: ${check.why}. Install or configure the test runner in this project's environment, then Resume. The candidate files are preserved; no QA approval was issued.`);
    }
    if (!check.passed && !check.unrunnable) {
      try {
        const repaired = await repairIntegration(command, check, signal);
        if (repaired) {
          check = repaired.result;
          candidateApplied = [...candidateApplied, ...repaired.added];
        }
      } catch (error) {
        await withdrawCandidate(candidateApplied);
        throw error;
      }
    }
    if (check.unrunnable) throw new Error(`Verification "${command}" became unavailable during repair: ${check.why}. Fix the environment and Resume; no QA approval was issued.`);
    const { passed, raw, verification } = check;
    if (!passed) {
      await withdrawCandidate(candidateApplied);
      const tail = firstFailure.raw.slice(-4000);
      noteFeedback(mission.id, { agentId: 'team', source: 'verification', text: `"${command}" failed (exit ${firstFailure.exitCode}): ${tail.slice(-500)}` });
      const rejectCount = (currentMission()?.qaRejectCount ?? 0) + 1;
      const verifyLoops = (currentMission()?.verifyLoopCount ?? 0) + 1;
      store.updateMission({ qaRejectCount: rejectCount, verifyLoopCount: verifyLoops, status: 'qa_loopback' });
      store.setAgentStatus(qa.id, 'idle');
      if (verifyLoops > MAX_VERIFY_LOOPS) {
        await restorePassingCandidate(`Verification failed after ${MAX_VERIFY_LOOPS} rework rounds.`);
        store.updateTask(QA_TASK_ID, { status: 'rejected', progress: 100, qaFeedback: `Verification "${command}" still failed after ${MAX_VERIFY_LOOPS} rework rounds.` });
        return 'rejected';
      }
      const current = currentMission()!;
      for (const task of reworkClosure(blameTasks(tail, current.proposedChanges ?? [], workTasks), workTasks)) {
        recordModelResult(servedByTask.get(task.id) ?? task.model, false);
        const feedback = `Verification "${command}" failed (exit ${firstFailure.exitCode}) on the changes the team proposed. Fix the cause. Output (end):\n${tail}`;
        store.updateTask(task.id, { status: 'rejected', qaFeedback: feedback, stage: 'implementation' });
        noteFeedback(mission.id, { agentId: task.assignedAgentId, source: 'verification', text: `${task.title}: ${tail.slice(-300)}`, taskId: task.id });
      }
      store.updateTask(QA_TASK_ID, { status: 'pending', progress: 0 });
      return 'retry';
    }
    verificationNote = `\n\nVerification: "${command}" passed (exit 0) when run on the proposed changes. Output (end):\n${raw.slice(-1500)}`;
    verified = passed;
    if (passed) {
      const current = currentMission()!;
      store.updateMission({ passingCandidate: structuredClone({ changes: current.proposedChanges ?? [], tasks: current.tasks, verification }) });
    }
  }

  const digest = verified ? finalFileDigest(currentMission()?.proposedChanges ?? [], 80_000) : undefined;
  const finalFiles = digest
    ? `\n\nFinal file contents (authoritative; this is the code on disk that verification ran against, one version per file, most recently changed first):\n${digest.text}${digest.omitted.length ? `\n\nNot shown above for space, read with project-call before judging them: ${digest.omitted.join(', ')}` : ''}`
    : '';
  const deliverables = workTasks
    .map((t) => `## [${t.id}] ${t.title} — ${store.agents[t.assignedAgentId]?.name}\n${digest?.text ? compactFileOutputs(t.output ?? '', 4_000) : truncate(stripThinking(t.output ?? ''), 8_000)}`)
    .join('\n\n');
  const ownTests = runCreatedTests(currentMission()?.proposedChanges ?? []);
  const modifiedTests = runModifiedTests(currentMission()?.proposedChanges ?? []);
  const modTestNote = modifiedTests.length
    ? `\n\nExisting test files modified by the team during this run (${modifiedTests.join(', ')}): keep every pre-existing test in them intact, while any new test assertions added during this run are held to the requirements and may be corrected (or moved into a new test file) if wrong.`
    : '';
  const ownTestsNote = (ownTests.length
    ? `\n\nTests created by the team during this run (not part of the original project, so the user's rule about existing tests does not protect them): ${ownTests.join(', ')}. Hold them to the requirements like any other new code. If one pins behaviour the requirements contradict, report it as a defect in that test file; the team can correct it.`
    : '') + modTestNote;
  const qaMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [{
    role: 'user',
    content: `Request:\n${mission.prompt}${await attachmentContext(mission.contextFiles)}\n\nDeliverables (task reports; code quoted in them may be superseded by later rework, so judge code only from the final file contents or project-call):\n${deliverables}${verificationNote}${verified ? '\nThe verification above was run by Agent HQ on the final files; you do not need to run it yourself.' : ''}${finalFiles}${ownTestsNote}\n\n${projectContext()}\n\nCompare each requested behavior with the current code, including entry points and shared files. Read the attached requirements and any file clipped or absent above using project-call BEFORE giving your JSON verdict — never reject because source or a file was omitted from the prompt. Audit entry-point boundary/error-handling consistency across sibling handlers, data/storage scope invariants in touched and untouched modules, and worst-case complexity against stated bounds. Before reporting a defect, check that the cited code path is the one the failing input actually reaches in the final files. Passing tests cover only their assertions; concrete unmet requirements still need repair.`,
  }];
  const review = async () => callAgent(qa, {
    system: `${qa.systemPrompt}${await memoryBrief(qa.id, mission.prompt)}\n\nIf any file you need to inspect is omitted or clipped in the prompt, reply FIRST with a single \`\`\`project-call\`\`\` read_files/list_files block (per the project tools notice) and wait for its result — do NOT reject for missing context or unprovided project-call output. Once you have inspected every needed file, respond with ONLY a single JSON object: {"verdict": "approve" | "reject", "summary": "...", "issues": [{"taskId": "<exact task id such as t1, t2 from Deliverables (never an issue number)>", "problem": "<concrete defect and failing input or unmet requirement>", "path": "<exact proposed file path>", "evidence": "<exact code excerpt of at least 12 characters causing the defect>"}]}. Reject only for real defects, security problems or unmet requirements. Judge only against requirements stated in the request/attached specs and pre-existing baseline behavior — do not invent unrequested edge-case contracts or out-of-spec caller assumptions as grounds to reject. Pre-existing behavior in untouched files (routes, CLI commands, public functions, or storage behavior) is part of the baseline contract unless the request or attached issues explicitly ask to change or remove it — never instruct the team to remove or alter working pre-existing endpoints merely because a summary spec omits them. Passing verification is direct execution evidence. Missing hidden tests, hypothetical failures, lack of visibility and requests for more test coverage are advisory concerns, not grounds for rejection. For a rejection after passing verification, cite the exact offending code from the supplied file contents and explain its incorrect behavior.`,
    messages: qaMessages,
    signal,
    note: 'QA review',
    countInRun: true,
    toolNotice: PROJECT_TOOL_INSTRUCTIONS,
  });
  let result = await review();
  for (let turn = 0; ; turn++) {
    const parsed = parseProjectRequest(result.text);
    if (!parsed) break;
    if (turn >= MAX_PROJECT_TURNS) throw new Error('QA exhausted its project read turns without producing a verdict.');
    qaMessages.push({ role: 'assistant', content: result.text }, { role: 'user', content: await projectToolReply(parsed) });
    compactToolHistory(qaMessages, 4);
    result = await review();
  }
  const tokens = usageTokens(result.usage);
  let verdict;
  try {
    verdict = parseQaVerdict(result.text, workTasks.map((t) => t.id), workTasks);
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
    if (verified) {
      const available = new Set(useWorkspaceStore.getState().tree.filter((entry) => entry.type === 'file').map((entry) => entry.path));
      const paths = [...new Set(verdict.issues.map((issue) => issue.path).filter((path): path is string => !!path && available.has(path)))];
      const inspected = await Promise.all(paths.map(async (path) => ({ path, content: (await api.readFileIfExists(path))?.content })));
      const issues = evidencedQaIssues(verdict, currentMission()?.proposedChanges ?? [], inspected.filter((file): file is { path: string; content: string } => typeof file.content === 'string'));
      if (!issues.length) {
        store.updateMission({ qaConcerns: `Verification passed; QA raised advisory concerns without a concrete code citation: ${verdict.summary}` });
        store.updateTask(QA_TASK_ID, { status: 'completed', progress: 100, completedAt: Date.now(), qaFeedback: verdict.summary });
        store.logActivity({ kind: 'qa', level: 'warn', runId: mission.id, text: 'Kept the verified changes. QA supplied no concrete code evidence for rejection; its concerns remain visible.' });
        return 'retained';
      }
      verdict.issues = issues;
    } else {
      await withdrawCandidate(candidateApplied);
    }
    const rejectCount = (currentMission()?.qaRejectCount ?? 0) + 1;
    const reviewRejects = (currentMission()?.qaReviewRejectCount ?? 0) + 1;
    const raised = new Set(currentMission()?.qaRaisedIssues ?? []);
    const repeated = new Set(verdict.issues.filter((issue) => raised.has(qaIssueKey(issue))).map(qaIssueKey));
    const fresh = verdict.issues.filter((issue) => !repeated.has(qaIssueKey(issue)));
    const newDefectRound = verified && fresh.length > 0 && reviewRejects <= MAX_QA_LOOPS + MAX_NEW_DEFECT_ROUNDS;
    store.updateMission({ qaRejectCount: rejectCount, qaReviewRejectCount: reviewRejects, status: 'qa_loopback', qaRaisedIssues: [...raised, ...fresh.map(qaIssueKey)] });
    const flagged = new Set(verdict.issues.map((i) => i.taskId).filter(Boolean));
    const targets = selectQaReworkTargets(flagged, workTasks);
    store.logActivity({ kind: 'qa', level: 'warn', runId: mission.id, agentId: qa.id, text: `Sentinel rejected ${targets.length} task(s): ${verdict.summary}` });
    if (reviewRejects > MAX_QA_LOOPS && !newDefectRound) {
      await restorePassingCandidate(verdict.summary);
      store.updateTask(QA_TASK_ID, { status: 'rejected', progress: 100, qaFeedback: verdict.summary });
      return 'rejected';
    }
    if (reviewRejects > MAX_QA_LOOPS) {
      store.logActivity({ kind: 'qa', level: 'info', runId: mission.id, agentId: qa.id, text: `QA found ${fresh.length} defect(s) the team was never asked to fix, so one more rework round runs before the run can fail.` });
    }
    for (const t of targets) {
      recordModelResult(servedByTask.get(t.id) ?? t.model, false);
      const evidence = verdict.issues.filter((i) => i.taskId === t.id || !i.taskId).map((i) => `- ${i.problem}${i.path ? `\nFile: ${i.path}` : ''}${i.evidence ? `\nOffending code: ${i.evidence}` : ''}${repeated.has(qaIssueKey(i)) ? '\nQA raised this before. If the final code already handles it, show that with a regression test for the exact failing input and say so; otherwise fix it.' : ''}`).join('\n') || verdict.summary;
      const feedback = `${evidence}\nAdd a focused regression test that reproduces the reported defect. Preserve the tests that existed before this run and all other requested behavior.${ownTests.length ? ` Tests created by the team during this run (${ownTests.join(', ')}) are not protected: if one asserts behaviour the requirements contradict, correct it in the same change.` : ''}`;
      store.updateTask(t.id, { status: 'rejected', qaFeedback: feedback, stage: 'implementation' });
      noteFeedback(mission.id, { agentId: t.assignedAgentId, source: 'qa', text: `${t.title}: ${feedback}`, taskId: t.id });
    }
    store.updateTask(QA_TASK_ID, { status: 'pending', progress: 0 });
    return 'retry';
  }

  store.updateTask(QA_TASK_ID, { status: 'completed', progress: 100, completedAt: Date.now() });
  for (const t of workTasks) if (currentMission()?.tasks.find((x) => x.id === t.id)?.status === 'completed') recordModelResult(servedByTask.get(t.id) ?? currentMission()!.tasks.find((x) => x.id === t.id)!.model, true);
  store.logActivity({ kind: 'qa', level: 'success', runId: mission.id, agentId: qa.id, text: `Sentinel approved the run: ${verdict.summary}` });
  return 'approved';
}

/** Puts changes that were written for verification back, and makes them proposals again so a later round can use them. */
async function withdrawCandidate(ids: string[]) {
  for (const id of [...ids].reverse()) {
    try {
      await revertProposedChange(id);
    } catch (err) {
      agentsState().logActivity({ kind: 'info', level: 'error', runId: currentMission()?.id, text: `Could not undo a verification write: ${(err as Error).message}` });
      throw err;
    }
    agentsState().updateProposedChange(id, { status: 'pending', appliedAt: undefined, autoApplied: undefined });
  }
}

async function restorePassingCandidate(concerns: string): Promise<boolean> {
  const store = agentsState();
  const current = currentMission();
  const checkpoint = current?.passingCandidate;
  if (!checkpoint || !autoAppliesChanges(store.approvalMode)) return false;
  await withdrawCandidate((current.proposedChanges ?? []).filter((change) => change.status === 'applied').map((change) => change.id));
  store.updateMission({
    proposedChanges: checkpointProposals(checkpoint.changes),
    tasks: structuredClone(checkpoint.tasks),
  });
  const written = await autoApplyChanges();
  if (written.failed) throw new Error('Could not restore all files from the passing candidate.');
  const result = await useWorkspaceStore.getState().runCommand(checkpoint.verification.command);
  const verification = {
    command: checkpoint.verification.command,
    exitCode: result.exitCode ?? null,
    output: truncate(`${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim(), 20_000),
    durationMs: result.durationMs ?? 0,
    ranAt: Date.now(),
  };
  store.updateMission({ verification });
  if (result.rejected || result.exitCode !== 0) throw new Error('Restored candidate no longer passes verification; review the verification output.');
  store.updateMission({ qaConcerns: `Restored the last passing candidate. Unresolved QA concerns: ${concerns}` });
  store.updateTask(QA_TASK_ID, { status: 'completed', progress: 100, completedAt: Date.now(), qaFeedback: concerns });
  store.logActivity({ kind: 'qa', level: 'warn', runId: current.id, text: 'Restored the last passing candidate and verified it again. QA concerns remain unresolved.' });
  return true;
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
  store.updateMission({ status, error, completedAt: status === 'paused' ? undefined : now });
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
    completedAt: status === 'paused' ? undefined : now,
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
    qaConcerns: m.qaConcerns,
  };
  store.finalizeRun(record);
  store.logActivity({
    kind: 'run',
    level: status === 'completed' ? 'success' : status === 'cancelled' || status === 'paused' ? 'warn' : 'error',
    runId: m.id,
    text: `Run ${status}${error ? `: ${error}` : ''}`,
  });
  store.appendChatMessage({
    sender: 'system',
    text:
      status !== 'completed'
        ? `Run ${status}${error ? `: ${error}` : '.'}`
        : m.qaConcerns
          ? `Run completed with unresolved QA concerns. Verified changes are on disk. ${m.qaConcerns}`
          : autoApplied
          ? `Run completed and approved by QA. Auto mode wrote ${autoApplied.applied} file(s) to the project${autoApplied.failed ? `; ${autoApplied.failed} could not be written` : ''}. Undo any of them in the Changes panel.`
          : `Run completed and approved by QA. ${m.proposedChanges?.length ?? 0} proposed file change(s) are ready to review in the Changes panel.`,
  });
}

export async function executeRun() {
  const store = agentsState();
  const mission = currentMission();
  if (!mission) return;
  cancelQuotaAutoResume();
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
  store.updateMission({ status: 'running', error: undefined, interrupted: undefined, qaCertificate: undefined });
  const guard: RunGuard = { startedAt: Date.now(), callsByAgent: {}, costByAgent: {}, warned: new Set(), warnedBudgets: new Set(), stopReason: null, timers: [] };
  runGuard = guard;
  const minutes = store.runLimits.maxMinutes;
  if (minutes !== null) {
    const ms = minutes * 60_000;
    guard.timers.push(setTimeout(() => runGuard === guard && enforceQuietly(guard), ms * WARN_RATIO));
    guard.timers.push(setTimeout(() => runGuard === guard && enforceQuietly(guard), ms));
  }

  try {
    const command = store.verificationCommand.trim();
    if (command && autoAppliesChanges(store.approvalMode)) {
      const result = await useWorkspaceStore.getState().runCommand(command);
      const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
      if (result.rejected || verificationCouldNotRun(result.exitCode ?? null, output)) {
        throw new Error(`Verification "${command}" is unavailable: ${output.slice(-2000)}. Install or configure the test runner in this project's environment, then Resume. No implementation calls were made.`);
      }
      store.logActivity({ kind: 'verification', level: 'info', runId: mission.id, text: `Verification preflight finished (exit ${result.exitCode ?? 'unknown'}). Its result is a baseline, not acceptance of the changes.` });
    }
    let retained = false;
    for (;;) {
      await runWorkTasks(controller.signal);
      if (guard.stopReason) throw limitStopError(guard.stopReason);
      const failed = currentMission()!.tasks.filter((t) => t.id !== QA_TASK_ID && t.status === 'failed');
      if (failed.length) {
        await restorePassingCandidate(`${failed.length} rework task(s) failed.`);
        finalize('failed', `${failed.length} task(s) failed. Fix the cause and use Retry.`);
        return;
      }
      const outcome = await runQa(controller.signal);
      if (guard.stopReason) throw limitStopError(guard.stopReason);
      if (outcome === 'retry') continue;
      if (outcome === 'rejected') {
        finalize('failed', 'QA rejected the result after the allowed rework loop.');
        return;
      }
      retained = outcome === 'retained';
      break;
    }

    if (autoAppliesChanges(store.approvalMode)) {
      if (command && currentMission()?.proposedChanges?.some((change) => change.status === 'pending')) {
        throw new Error('Cannot complete this run: file proposals changed after verification. Resume to verify the complete candidate again.');
      }
      const outcome = await autoApplyChanges();
      if (outcome.failed || currentMission()?.proposedChanges?.some((change) => change.status === 'pending')) {
        throw new Error('Cannot complete this run: some proposed files were not written. Resolve the remaining changes and Resume.');
      }
    }
    const m = currentMission()!;
    const finalFiles = new Map<string, string>();
    for (const change of m.proposedChanges ?? []) if (change.status === 'applied' || change.status === 'pending') finalFiles.set(change.path, change.content);
    const payload = [
      ...m.tasks.map((t) => `${t.id}\n${t.output ?? ''}`),
      ...[...finalFiles].sort(([first], [second]) => first.localeCompare(second)).map(([path, content]) => `FILE ${path}\n${content}`),
    ].join('\n\n');
    const hash = await sha256(payload);
    const qa = agentsState().agents['agent-qa'];
    agentsState().updateMission({
      currentStage: 'shipped',
      stageIndex: 4,
      tasks: m.tasks.map((t) => ({ ...t, stage: 'shipped' })),
      qaCertificate: retained ? undefined : {
        certificateId: `cert-${m.id}`,
        missionId: m.id,
        missionTitle: m.title,
        signedByAgentId: qa.id,
        signedByName: qa.name,
        signedByModel: resolveAgentModel(qa, agentsState().roleDefaults),
        sha256Hash: hash,
        hashScope: `Outputs of ${m.tasks.length} tasks and ${finalFiles.size} final file proposals`,
        timestamp: new Date().toISOString(),
        source: 'live',
        qaVerdict: 'approve',
        verificationCommand: m.verification?.command,
        verificationExitCode: m.verification?.exitCode,
        summaryNotes: m.qaNotes ?? '',
      },
    });
    const autoApplied = autoAppliesChanges(agentsState().approvalMode)
      ? { applied: (m.proposedChanges ?? []).filter((change) => change.status === 'applied').length, failed: 0 }
      : undefined;
    finalize('completed', undefined, autoApplied);
  } catch (err) {
    if (guard.providerLimit) {
      const limit = guard.providerLimit;
      store.updateMission({
        providerLimit: limit,
        tasks: currentMission()!.tasks.map((task) => {
          if (task.status !== 'in_progress' && task.status !== 'review') return task;
          return task.computerActions
            ? { ...task, status: 'failed', progress: 0, error: DESKTOP_INTERRUPTED, computerNeedsReview: true }
            : { ...task, status: 'pending', progress: 0, error: undefined };
        }),
      });
      const until = new Date(limit.resetAt).toLocaleString();
      finalize('paused', `${limit.provider} usage limit reached. ${limit.resetKnown ? `Resets ${until}` : `Reset time unknown; try again after ${until}`}. Finished work is kept. Resume after reset or connect another provider.`);
      if ((agentsState().budgetPolicy ?? DEFAULT_BUDGET_POLICY).autoResumeOnQuotaReset) {
        scheduleQuotaAutoResume(limit.resetAt);
      }
    } else if (guard.stopReason) finalize('failed', `Stopped by run limit: ${guard.stopReason}. Raise the limit in Settings → Run limits, then Resume.`);
    else if (isAbort(err)) finalize('cancelled', 'Stopped by user.');
    else finalize('failed', (err as Error).message);
  } finally {
    guard.timers.forEach(clearTimeout);
    if (runGuard === guard) runGuard = null;
    if (runController === controller) runController = null;
    if (!guard.providerLimit) {
      store.updateMission({ providerLimit: undefined });
      void learnFromRun(mission.id);
    }
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

let quotaResumeTimer: ReturnType<typeof setTimeout> | null = null;

export function cancelQuotaAutoResume() {
  if (quotaResumeTimer) {
    clearTimeout(quotaResumeTimer);
    quotaResumeTimer = null;
  }
  agentsState().setQuotaAutoResumeAt?.(null);
}

export function scheduleQuotaAutoResume(resetAt: number) {
  cancelQuotaAutoResume();
  const delay = Math.max(1_000, resetAt - Date.now());
  const resumeAt = Date.now() + delay;
  const mission = currentMission();
  agentsState().setQuotaAutoResumeAt?.(resumeAt);
  agentsState().logActivity({
    kind: 'run',
    level: 'info',
    runId: mission?.id,
    text: `Scheduled automatic resume for ${new Date(resumeAt).toLocaleTimeString()} when provider quota resets.`,
  });
  quotaResumeTimer = setTimeout(() => {
    quotaResumeTimer = null;
    agentsState().setQuotaAutoResumeAt?.(null);
    const current = currentMission();
    if (!current || agentsState().isLiveRunning || current.status !== 'paused') return;
    if (current.providerLimit) useConnectionsStore.getState().clearExhausted(current.providerLimit.provider);
    agentsState().logActivity({ kind: 'run', level: 'info', runId: current.id, text: 'Provider quota reset window reached — auto-resuming run.' });
    void resumeRun();
  }, delay);
}

export function enableQuotaAutoResumeForCurrentMission(): boolean {
  const m = currentMission();
  if (!m?.providerLimit || m.status !== 'paused') return false;
  scheduleQuotaAutoResume(m.providerLimit.resetAt);
  return true;
}

export function stopRun() {
  cancelQuotaAutoResume();
  runController?.abort();
}

/** Runs pending work tasks in dependency waves, several at once, never two for the same agent. */
async function runWorkTasks(signal: AbortSignal) {
  const desktopEnabled = (await desktopTools(currentMission()!.id)).length > 0;
  const running = new Map<string, Promise<void>>();
  let fatal: unknown = null;
  for (;;) {
    if (signal.aborted && !fatal) fatal = Object.assign(new Error('Aborted'), { name: 'AbortError' });
    if (!fatal) {
      const work = topoOrder(currentMission()!.tasks.filter((t) => t.id !== QA_TASK_ID));
      const reference = new Set(currentMission()?.contextFiles ?? []);
      const workspaceFiles = useWorkspaceStore.getState().tree.filter((e) => e.type === 'file' && !reference.has(e.path) && !/\.(md|txt)$/i.test(e.path)).map((e) => e.path);
      const filesOf = (t: { title: string; description?: string }) => selectRelevantFiles(`${t.title}\n${t.description ?? ''}`, workspaceFiles, 12);
      const { start, blocked } = planNextWave(work, new Set(running.keys()), desktopEnabled ? 1 : parallelLimit(agentsState().maxParallel), filesOf);
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

/** Called once at startup: in Full access an interrupted run continues by itself, within the run limits. */
export async function resumeInterruptedRun() {
  const store = agentsState();
  const m = currentMission();
  if (!shouldAutoResume(m, store.approvalMode, store.isLiveRunning)) return;
  store.logActivity({ kind: 'run', level: 'info', runId: m!.id, text: 'Full access: resuming the run that was interrupted when Agent HQ closed' });
  await resumeRun();
}

export async function resumeRun() {
  cancelQuotaAutoResume();
  const m = currentMission();
  if (!m || agentsState().isLiveRunning) return;
  if (m.providerLimit && isProviderExhausted(useConnectionsStore.getState().exhausted, m.providerLimit.provider)) {
    const { providers, exhausted } = useConnectionsStore.getState();
    const blocked = m.providerLimit.provider;
    const available = providers.some((provider) => provider.id !== blocked && provider.connection
      && !isProviderExhausted(exhausted, provider.id) && provider.models.some((model) => model.selectable !== false));
    if (!available) {
      agentsState().logActivity({ kind: 'run', level: 'warn', runId: m.id, text: m.error ?? 'Provider usage limit has not reset yet.' });
      return;
    }
  }
  if (m.tasks.some((task) => task.computerNeedsReview || task.error === DESKTOP_INTERRUPTED)) {
    agentsState().logActivity({ kind: 'run', level: 'warn', runId: m.id, text: 'Inspect the desktop app, then Retry the interrupted desktop task before resuming. Its actions may already have taken effect.' });
    return;
  }
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
  agentsState().updateTask(taskId, { status: 'pending', error: undefined, output: undefined, computerNeedsReview: undefined });
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
  if (change.conflictsWith?.length) {
    const rivals = (currentMission()?.proposedChanges ?? []).filter((c) => c.id !== changeId && c.path === change.path && c.status === 'pending');
    for (const rival of rivals) agentsState().setProposedChangeStatus(rival.id, 'discarded');
    if (rivals.length) agentsState().logActivity({ kind: 'info', level: 'info', runId: m!.id, text: `Kept this version of ${change.path}; discarded ${rivals.length} competing proposal${rivals.length === 1 ? '' : 's'}` });
  }
  const after = currentMission();
  if (after?.proposedChanges) agentsState().updateMission({ proposedChanges: markConflicts(after.proposedChanges, after.tasks) });
}

/** Puts a file back the way it was before the change was applied; deletes it if the change created it. */
export async function revertProposedChange(changeId: string) {
  const m = currentMission();
  const change = m?.proposedChanges?.find((c) => c.id === changeId);
  if (!change || change.status !== 'applied' || change.previousContent === undefined) return;
  if (await currentContent(change.path) !== change.content) {
    throw new Error(`${change.path} changed after Agent HQ wrote it. Undo stopped to preserve external edits.`);
  }
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
  const { apply, superseded, conflicted } = selectAutoApply(currentMission()?.proposedChanges ?? [], currentMission()?.tasks ?? []);
  for (const change of superseded) agentsState().setProposedChangeStatus(change.id, 'discarded');
  const clashPaths = [...new Set(conflicted.map((c) => c.path))];
  if (clashPaths.length) {
    agentsState().logActivity({ kind: 'info', level: 'warn', runId: currentMission()?.id, text: `Not written automatically, because independent tasks changed the same file: ${clashPaths.join(', ')}. Choose a version in the Changes tab.` });
  }
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
