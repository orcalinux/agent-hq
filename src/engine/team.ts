import type { AgentProfile, AgentRole, AIModelId } from '@/types';
import { specialtyMeta } from './internshipSystem';

/** Agents that can mentor: anyone who is not a junior and not Sovereign. */
export function seniorsOf(agents: Record<string, AgentProfile>): AgentProfile[] {
  return Object.values(agents).filter((a) => !a.internship?.isIntern && a.role !== 'manager' && a.role !== 'intern');
}

/** Who can be a junior's N+1: every senior, then Sovereign as the direct manager. */
export function mentorCandidates(agents: Record<string, AgentProfile>): AgentProfile[] {
  return [...seniorsOf(agents), ...Object.values(agents).filter((a) => a.role === 'manager')];
}

export function juniorsOf(agents: Record<string, AgentProfile>, mentorId: string): AgentProfile[] {
  return Object.values(agents).filter((a) => a.internship?.isIntern && a.internship.mentorId === mentorId);
}

const words = (s: string | undefined) => new Set((s ?? '').toLowerCase().split(/[^a-z0-9+#]+/).filter((w) => w.length > 2));

/**
 * The best N+1 mentor for a junior: a senior whose specialty or title shares words with the junior's
 * specialty, then one in the role the junior graduates into, then the senior with the fewest juniors.
 */
export function suggestMentor(agents: Record<string, AgentProfile>, specialty: string, baseRole?: AgentRole, exclude?: string): string {
  const role = specialtyMeta(specialty, baseRole).role;
  const want = words(specialty);
  const scored = seniorsOf(agents)
    .filter((a) => a.id !== exclude)
    .map((a, index) => {
      const theirs = words(`${a.specialty ?? ''} ${a.title}`);
      const overlap = [...want].filter((w) => theirs.has(w)).length;
      return { id: a.id, score: overlap * 10 + (a.role === role ? 5 : 0) - juniorsOf(agents, a.id).length, index };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);
  return scored[0]?.id ?? Object.values(agents).find((a) => a.role === 'manager' && a.id !== exclude)?.id ?? '';
}

/**
 * An exact model for a new agent: the one asked for, else its role's default, else Sovereign's model,
 * else the first available model. Only refs from `available` are used when that list is known.
 */
export function pickModel(requested: string | undefined, role: AgentRole, roleDefaults: Record<AgentRole, AIModelId>, fallback: AIModelId, available: string[]): AIModelId {
  const ok = (ref: string | undefined): ref is string => Boolean(ref) && (!available.length || available.includes(ref!));
  for (const ref of [requested, roleDefaults[role], fallback, available[0]]) if (ok(ref)) return ref;
  return '';
}
