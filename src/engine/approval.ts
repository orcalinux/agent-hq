import type { ApprovalMode, OrchestratorMode, ProposedFileChange } from '@/types';

export interface ApprovalModeInfo {
  id: ApprovalMode;
  label: string;
  short: string;
  description: string;
}

export const APPROVAL_MODES: ApprovalModeInfo[] = [
  {
    id: 'ask',
    label: 'Ask every time',
    short: 'Ask',
    description: 'You approve each plan and apply every file change yourself.',
  },
  {
    id: 'auto',
    label: 'Auto-apply changes',
    short: 'Auto',
    description: 'You approve the plan; file changes that pass QA are written to the project automatically.',
  },
  {
    id: 'full',
    label: 'Full access',
    short: 'Full access',
    description: 'Build requests run at once without plan approval, and changes that pass QA are written automatically.',
  },
];

export function approvalModeInfo(mode: ApprovalMode): ApprovalModeInfo {
  return APPROVAL_MODES.find((m) => m.id === mode) ?? APPROVAL_MODES[0];
}

/** Whether QA-approved file changes are written without the user clicking Apply. */
export function autoAppliesChanges(mode: ApprovalMode): boolean {
  return mode === 'auto' || mode === 'full';
}

/** Whether a proposed plan starts running without the user approving it. Only Build requests run. */
export function autoStartsRuns(mode: ApprovalMode, orchestratorMode: OrchestratorMode): boolean {
  return mode === 'full' && orchestratorMode === 'build';
}

interface TaskLink {
  id: string;
  dependsOn?: string[];
}

function ancestorsOf(tasks: TaskLink[]): Map<string, Set<string>> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const memo = new Map<string, Set<string>>();
  const visit = (id: string, seen: Set<string>): Set<string> => {
    const known = memo.get(id);
    if (known) return known;
    const out = new Set<string>();
    if (seen.has(id)) return out;
    seen.add(id);
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      out.add(dep);
      for (const a of visit(dep, seen)) out.add(a);
    }
    memo.set(id, out);
    return out;
  };
  for (const t of tasks) visit(t.id, new Set());
  return memo;
}

/**
 * Marks pending proposals that clash: two tasks proposing the same file when neither depends on the other, so
 * neither saw the other's version. A task that builds on an earlier one replaces its proposal, which is not a clash.
 */
export function markConflicts<T extends ProposedFileChange>(changes: T[], tasks: TaskLink[]): T[] {
  const ancestors = ancestorsOf(tasks);
  const related = (a: string, b: string) => a === b || !!ancestors.get(a)?.has(b) || !!ancestors.get(b)?.has(a);
  const pendingByPath = new Map<string, T[]>();
  for (const c of changes) if (c.status === 'pending') pendingByPath.set(c.path, [...(pendingByPath.get(c.path) ?? []), c]);
  return changes.map((c) => {
    if (c.status !== 'pending') return c.conflictsWith ? { ...c, conflictsWith: undefined } : c;
    const others = (pendingByPath.get(c.path) ?? []).filter((o) => !related(o.taskId, c.taskId)).map((o) => o.taskId);
    const conflictsWith = others.length ? [...new Set(others)] : undefined;
    return (c.conflictsWith?.join() ?? '') === (conflictsWith?.join() ?? '') ? c : { ...c, conflictsWith };
  });
}

/**
 * Picks the pending changes auto mode should write: one per path, the latest proposal wins when each later task
 * built on the earlier one. Earlier proposals for that path are returned as superseded. Paths where independent
 * tasks clash are returned as conflicted and left for the user.
 */
export function selectAutoApply(changes: ProposedFileChange[], tasks: TaskLink[] = []): { apply: ProposedFileChange[]; superseded: ProposedFileChange[]; conflicted: ProposedFileChange[] } {
  const pending = markConflicts(changes, tasks).filter((c) => c.status === 'pending');
  const clashing = new Set(pending.filter((c) => c.conflictsWith?.length).map((c) => c.path));
  const conflicted = pending.filter((c) => clashing.has(c.path));
  const clean = pending.filter((c) => !clashing.has(c.path));
  const latest = new Map<string, ProposedFileChange>();
  for (const change of clean) latest.set(change.path, change);
  const keep = new Set([...latest.values()].map((c) => c.id));
  return {
    apply: clean.filter((c) => keep.has(c.id)),
    superseded: clean.filter((c) => !keep.has(c.id)),
    conflicted,
  };
}

/** A change can be undone when it was applied and its previous state is known. */
export function canRevert(change: ProposedFileChange): boolean {
  return change.status === 'applied' && change.previousContent !== undefined;
}
