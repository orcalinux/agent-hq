import type { AgentProfile, OrchestratorPlan, PlanTask, ProposedAgent, SOPStage } from '../types';
import { parseComplexity } from './modelRouting';

const STAGES: SOPStage[] = ['briefing', 'architecture', 'implementation', 'qa_review', 'shipped'];
const PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;

/** Removes <think>…</think> reasoning blocks that some local models emit. */
export function stripThinking(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>\s*/gi, '')
    .replace(/^[\s\S]*?<\/think>\s*/i, '')
    .replace(/<think>[\s\S]*$/i, '');
}

/** Extracts the first JSON object from a model response (fenced or bare). */
export function extractJson(text: string): unknown {
  const clean = stripThinking(text);
  const fence = clean.match(/```(?:json)?\s*\n([\s\S]*?)```/i);
  const candidates = fence ? [fence[1], clean] : [clean];
  for (const candidate of candidates) {
    const start = candidate.indexOf('{');
    if (start < 0) continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < candidate.length; i++) {
      const ch = candidate[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(candidate.slice(start, i + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  throw new Error('The response did not contain valid JSON.');
}

function defaultStageForRole(role: AgentProfile['role']): SOPStage {
  if (role === 'manager') return 'briefing';
  if (role === 'architect') return 'architecture';
  if (role === 'qa') return 'qa_review';
  return 'implementation';
}

const NEW_AGENT_ROLES = ['architect', 'frontend', 'backend', 'qa'] as const;

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
}

function parseNewAgents(raw: unknown, agents: Record<string, AgentProfile>, models: Set<string> | undefined): ProposedAgent[] {
  if (!Array.isArray(raw)) return [];
  const taken = new Set(Object.values(agents).map((a) => a.name.toLowerCase()));
  const out: ProposedAgent[] = [];
  for (const item of raw as Array<Record<string, unknown>>) {
    if (!item || typeof item !== 'object') continue;
    const name = String(item.name ?? '').trim().slice(0, 40);
    if (!name || taken.has(name.toLowerCase())) continue;
    taken.add(name.toLowerCase());
    const role = NEW_AGENT_ROLES.includes(item.role as (typeof NEW_AGENT_ROLES)[number]) ? (item.role as ProposedAgent['role']) : 'backend';
    const title = String(item.title ?? '').trim().slice(0, 80) || `${role} specialist`;
    const model = typeof item.model === 'string' && (!models || models.has(item.model)) ? item.model : undefined;
    out.push({
      key: 'new:' + (slug(String(item.key ?? item.id ?? name)) || slug(name) || String(out.length + 1)),
      name,
      role,
      title,
      specialty: typeof item.specialty === 'string' ? item.specialty.trim().slice(0, 160) : undefined,
      focus: typeof item.focus === 'string' ? item.focus.trim().slice(0, 4000) : undefined,
      systemPrompt:
        String(item.systemPrompt ?? item.instructions ?? '').trim().slice(0, 4000) ||
        `You are ${name}, ${title} on an AI software engineering team coordinated by Sovereign. Be precise and output complete files.`,
      model,
      reason: typeof item.reason === 'string' ? item.reason.slice(0, 300) : undefined,
      ...(item.junior === true || item.level === 'junior' ? { junior: true, mentor: typeof item.mentor === 'string' ? item.mentor.trim() : undefined } : {}),
    });
  }
  return resolveMentors(out, agents);
}

/** Points each junior's mentor at a roster agent id or a senior's plan key; unknown mentors are left for later matching. */
function resolveMentors(proposed: ProposedAgent[], agents: Record<string, AgentProfile>): ProposedAgent[] {
  const byName = new Map(Object.values(agents).filter((a) => !a.internship?.isIntern).map((a) => [a.name.toLowerCase(), a.id]));
  const seniorKeys = new Map<string, string>();
  proposed.filter((p) => !p.junior).forEach((p) => {
    seniorKeys.set(p.key, p.key);
    seniorKeys.set(p.key.slice(4), p.key);
    seniorKeys.set(p.name.toLowerCase(), p.key);
  });
  return proposed.map((p) => {
    if (!p.junior) return p;
    const ref = (p.mentor ?? '').trim();
    const roster = agents[ref] && !agents[ref].internship?.isIntern ? ref : byName.get(ref.toLowerCase());
    const mentor = roster ?? seniorKeys.get(ref) ?? seniorKeys.get(ref.toLowerCase()) ?? seniorKeys.get(slug(ref.replace(/^new:/, '')));
    return { ...p, mentor };
  });
}

export function parsePlan(text: string, agents: Record<string, AgentProfile>, availableModels?: string[]): OrchestratorPlan {
  const raw = extractJson(text) as { summary?: unknown; tasks?: unknown; newAgents?: unknown; team?: unknown };
  if (!raw || !Array.isArray(raw.tasks) || raw.tasks.length === 0) throw new Error('The plan has no tasks.');
  const models = availableModels ? new Set(availableModels) : undefined;
  const newAgents = parseNewAgents(raw.newAgents ?? raw.team, agents, models);
  const byName = new Map(Object.values(agents).map((a) => [a.name.toLowerCase(), a.id]));
  const newByRef = new Map<string, ProposedAgent>();
  newAgents.forEach((n) => {
    newByRef.set(n.key, n);
    newByRef.set(n.key.slice(4), n);
    newByRef.set(n.name.toLowerCase(), n);
  });
  const usedIds = new Set<string>();
  const tasks: PlanTask[] = raw.tasks.map((t: Record<string, unknown>, idx: number) => {
    let id = String(t.id ?? `t${idx + 1}`).trim() || `t${idx + 1}`;
    while (usedIds.has(id)) id = `${id}-${idx}`;
    usedIds.add(id);
    const agentRef = String(t.agentId ?? t.agent ?? t.assignee ?? '').trim();
    const proposed = newByRef.get(agentRef) ?? newByRef.get(agentRef.toLowerCase()) ?? newByRef.get(slug(agentRef.replace(/^new:/, '')));
    const agentId = agents[agentRef] ? agentRef : byName.get(agentRef.toLowerCase()) ?? proposed?.key ?? 'agent-manager';
    const role = proposed?.role ?? agents[agentId]?.role ?? 'manager';
    const stage = STAGES.includes(t.stage as SOPStage) ? (t.stage as SOPStage) : defaultStageForRole(role);
    const priority = PRIORITIES.includes(t.priority as (typeof PRIORITIES)[number]) ? (t.priority as PlanTask['priority']) : 'medium';
    const model = typeof t.model === 'string' && t.model && (!models || models.has(t.model)) ? t.model : undefined;
    const complexity = parseComplexity(t.complexity ?? t.difficulty);
    const modelReason = model && typeof t.modelReason === 'string' && t.modelReason.trim() ? t.modelReason.trim().slice(0, 200) : undefined;
    return {
      id,
      title: String(t.title ?? `Task ${idx + 1}`).slice(0, 160),
      description: String(t.description ?? ''),
      stage: stage === 'qa_review' || stage === 'shipped' ? 'implementation' : stage,
      agentId,
      priority,
      dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn.map(String) : [],
      ...(model ? { model } : {}),
      ...(complexity ? { complexity } : {}),
      ...(modelReason ? { modelReason } : {}),
    };
  });
  const ids = new Set(tasks.map((t) => t.id));
  for (const t of tasks) t.dependsOn = t.dependsOn.filter((d) => ids.has(d) && d !== t.id);
  topoOrder(tasks);
  const used = new Set(tasks.map((t) => t.agentId));
  newAgents.forEach((n) => {
    if (n.junior && n.mentor && used.has(n.key)) used.add(n.mentor);
  });
  return { summary: String(raw.summary ?? ''), tasks, newAgents: newAgents.filter((n) => used.has(n.key)), status: 'proposed' };
}

/** Topological order by dependsOn; throws on cycles. */
export function topoOrder<T extends { id: string; dependsOn?: string[] }>(tasks: T[]): T[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const state = new Map<string, 'visiting' | 'done'>();
  const out: T[] = [];
  const visit = (t: T) => {
    const s = state.get(t.id);
    if (s === 'done') return;
    if (s === 'visiting') throw new Error(`Plan has a dependency cycle involving "${t.id}".`);
    state.set(t.id, 'visiting');
    for (const dep of t.dependsOn ?? []) {
      const d = byId.get(dep);
      if (d) visit(d);
    }
    state.set(t.id, 'done');
    out.push(t);
  };
  tasks.forEach(visit);
  return out;
}

export interface FileBlock {
  path: string;
  content: string;
}

const FILE_BLOCK = /```[^\n`]*?\bpath=["']?([^\s"'`]+)["']?[^\n]*\n([\s\S]*?)```/g;

/** Extracts proposed files written as ```lang path=relative/file.ext blocks. */
export function extractFileBlocks(text: string): FileBlock[] {
  const out = new Map<string, string>();
  for (const m of stripThinking(text).matchAll(FILE_BLOCK)) {
    if (m[1].startsWith('/')) continue;
    const path = m[1].replace(/^(\.\/+)+/, '');
    if (!path || path.split('/').includes('..')) continue;
    out.set(path, m[2]);
  }
  return Array.from(out, ([path, content]) => ({ path, content }));
}

export interface QaVerdict {
  verdict: 'approve' | 'reject';
  summary: string;
  issues: Array<{ taskId: string; problem: string; path?: string; evidence?: string }>;
}

export function parseQaVerdict(text: string, taskIds: string[]): QaVerdict {
  const raw = extractJson(text) as { verdict?: unknown; summary?: unknown; issues?: unknown };
  const verdict = String(raw.verdict ?? '').toLowerCase();
  if (verdict !== 'approve' && verdict !== 'reject') throw new Error('QA verdict must be "approve" or "reject".');
  const issues = Array.isArray(raw.issues)
    ? raw.issues
        .map((i: Record<string, unknown>) => ({
          taskId: String(i.taskId ?? ''),
          problem: String(i.problem ?? i.issue ?? ''),
          ...(typeof i.path === 'string' ? { path: i.path } : {}),
          ...(typeof i.evidence === 'string' ? { evidence: i.evidence } : {}),
        }))
        .filter((i) => i.problem)
    : [];
  const validIssues = issues.map((i) => ({ ...i, taskId: taskIds.includes(i.taskId) ? i.taskId : '' }));
  return { verdict, summary: String(raw.summary ?? ''), issues: validIssues };
}

export function parseMentorVerdict(text: string): { verdict: 'approve' | 'revise'; notes: string; revised?: string } {
  const clean = stripThinking(text);
  const m = clean.match(/VERDICT:\s*(APPROVE|REVISE)/i);
  const verdict = m && m[1].toUpperCase() === 'REVISE' ? 'revise' : 'approve';
  const notesMatch = clean.match(/NOTES:\s*([\s\S]*?)(?:\n(?:REVISED OUTPUT|REVISED):|$)/i);
  const revisedMatch = clean.match(/\n(?:REVISED OUTPUT|REVISED):\s*\n?([\s\S]*)$/i);
  return {
    verdict: m ? verdict : 'approve',
    notes: (notesMatch?.[1] ?? clean).trim().slice(0, 2000),
    revised: verdict === 'revise' ? revisedMatch?.[1]?.trim() : undefined,
  };
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`;
}

/** A mentor's revision replaces the junior's output only if it does not drop the files the junior delivered. */
export function adoptMentorRevision(original: string, revised: string | undefined): string {
  if (!revised) return original;
  const hadFiles = extractFileBlocks(original).length > 0;
  return hadFiles && extractFileBlocks(revised).length === 0 ? original : revised;
}
