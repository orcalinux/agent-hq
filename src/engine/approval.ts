import type { ApprovalMode, OrchestratorMode, ProposedFileChange } from '@/types';
import type { QaVerdict } from './orchestratorParsing';

export function evidencedQaIssues(verdict: QaVerdict, changes: ProposedFileChange[], inspected: Array<{ path: string; content: string }> = []): QaVerdict['issues'] {
  const latest = new Map<string, ProposedFileChange>();
  for (const change of changes) if (change.status === 'applied') latest.set(change.path, change);
  const current = new Map(inspected.map((file) => [file.path, file.content]));
  return verdict.issues.filter((issue) => {
    const change = issue.path ? latest.get(issue.path) : undefined;
    const content = issue.path ? current.get(issue.path) ?? change?.content : undefined;
    return content !== undefined && !!issue.taskId && (current.has(issue.path!) || change?.taskId === issue.taskId || change?.sourceTaskIds?.includes(issue.taskId))
      && !!issue.evidence?.trim() && issue.evidence.trim().length >= 12
      && content.includes(issue.evidence.trim());
  });
}

/**
 * One entry per path with its final applied content, most recently changed first, so a reviewer
 * never sees a superseded version and rework is never the part cut off by the size budget.
 */
export function finalFileDigest(changes: ProposedFileChange[], budget: number): { text: string; omitted: string[] } {
  const latest = new Map<string, ProposedFileChange>();
  for (const change of changes) {
    if (change.status !== 'applied') continue;
    latest.delete(change.path);
    latest.set(change.path, change);
  }
  const ordered = [...latest.values()].reverse();
  const parts: string[] = [];
  const omitted: string[] = [];
  let used = 0;
  for (const change of ordered) {
    const tasks = [...new Set([change.taskId, ...(change.sourceTaskIds ?? [])].filter(Boolean))].join(', ');
    const entry = `FILE ${change.path} (final version, last written by ${tasks || 'the team'})\n${change.content}`;
    if (used + entry.length > budget) {
      omitted.push(change.path);
      continue;
    }
    parts.push(entry);
    used += entry.length + 2;
  }
  return { text: parts.join('\n\n'), omitted };
}

/** Stable identity of a QA finding, so a repeated claim can be told apart from a newly found defect. */
export function qaIssueKey(issue: QaVerdict['issues'][number]): string {
  return `${issue.path ?? ''}\u0000${(issue.evidence ?? '').replace(/\s+/g, ' ').trim()}`;
}

const TEST_PATH = /(^|\/)(tests?|__tests__|spec)\/|(^|\/)test_[^/]*\.py$|_test\.(py|go)$|\.(test|spec)\.[cm]?[jt]sx?$/i;

/**
 * Test files that did not exist before this run. They are part of the candidate, not the project's
 * contract, so a repair may correct one that contradicts the requirements. Pre-existing tests stay protected.
 */
export function runCreatedTests(changes: ProposedFileChange[]): string[] {
  const created = new Set<string>();
  for (const change of changes) if (change.previousContent === null && TEST_PATH.test(change.path)) created.add(change.path);
  return [...created].sort();
}

export function checkpointProposals(changes: ProposedFileChange[]): ProposedFileChange[] {
  const latest = new Map<string, string>();
  for (const change of changes) if (change.status === 'applied') latest.set(change.path, change.id);
  return changes.map((change) => change.status === 'applied'
    ? { ...change, status: latest.get(change.path) === change.id ? 'pending' : 'discarded', appliedAt: undefined }
    : { ...change });
}

export function replaceMergedProposals(changes: ProposedFileChange[], originals: ProposedFileChange[], merged: ProposedFileChange): ProposedFileChange[] {
  if (!originals.length || !merged.content.trim() || merged.status !== 'pending' || originals.some((original) => original.path !== merged.path)) {
    throw new Error('A merge must contain one nonempty pending file matching every original proposal.');
  }
  for (const original of originals) {
    const current = changes.find((change) => change.id === original.id);
    if (!current || current.status !== 'pending' || current.content !== original.content) {
      throw new Error('A proposal changed during integration. Original proposals were preserved; retry the merge.');
    }
  }
  const replaced = new Set(originals.map((original) => original.id));
  return [...changes.map((change) => replaced.has(change.id) ? { ...change, status: 'discarded' as const } : change), merged];
}

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
 * built on the earlier one. A task that depends on another keeps its version even when the other was reworked later,
 * because it built on that file. Earlier proposals for that path are returned as superseded. Paths where independent
 * tasks clash are returned as conflicted and left for the user.
 */
export function selectAutoApply(changes: ProposedFileChange[], tasks: TaskLink[] = []): { apply: ProposedFileChange[]; superseded: ProposedFileChange[]; conflicted: ProposedFileChange[] } {
  const pending = markConflicts(changes, tasks).filter((c) => c.status === 'pending');
  const clashing = new Set(pending.filter((c) => c.conflictsWith?.length).map((c) => c.path));
  const conflicted = pending.filter((c) => clashing.has(c.path));
  const clean = pending.filter((c) => !clashing.has(c.path));
  const ancestors = ancestorsOf(tasks);
  const buildsOn = (a: ProposedFileChange, b: ProposedFileChange) => a.taskId !== b.taskId && !!ancestors.get(a.taskId)?.has(b.taskId);
  const latest = new Map<string, ProposedFileChange>();
  for (const change of clean) {
    const best = latest.get(change.path);
    if (!best || !buildsOn(best, change)) latest.set(change.path, change);
  }
  const keep = new Set([...latest.values()].map((c) => c.id));
  return {
    apply: clean.filter((c) => keep.has(c.id)),
    superseded: clean.filter((c) => !keep.has(c.id)),
    conflicted,
  };
}

/**
 * Tasks built on an invalidated result must run again, including consumers in different files.
 */
export function reworkClosure<T extends TaskLink>(targets: T[], tasks: T[]): T[] {
  const ancestors = ancestorsOf(tasks);
  const chosen = new Map(targets.map((t) => [t.id, t]));
  for (const task of tasks) if (targets.some((target) => ancestors.get(task.id)?.has(target.id))) chosen.set(task.id, task);
  return tasks.filter((t) => chosen.has(t.id));
}

/** A change can be undone when it was applied and its previous state is known. */
export function canRevert(change: ProposedFileChange): boolean {
  return change.status === 'applied' && change.previousContent !== undefined;
}

/** The tasks whose files a failing command names; when none are named, every task that proposed a change. */
export function blameTasks<T extends { id: string }>(output: string, changes: Array<{ taskId: string; path: string; status: string }>, tasks: T[]): T[] {
  const proposing = changes.filter((c) => c.status === 'pending');
  const named = new Set(
    proposing
      .filter((c) => {
        const base = c.path.slice(c.path.lastIndexOf('/') + 1);
        return output.includes(c.path) || (base.length >= 4 && output.includes(base));
      })
      .map((c) => c.taskId),
  );
  const pool = named.size ? named : new Set(proposing.map((c) => c.taskId));
  const blamed = tasks.filter((t) => pool.has(t.id));
  return blamed.length ? blamed : tasks;
}

/**
 * A verification command that failed because the tool itself is missing says nothing about the code.
 * A module the project's own code cannot import is a real failure, so only the runners are matched.
 */
export function verificationCouldNotRun(exitCode: number | null, output: string): boolean {
  if (exitCode === 127) return true;
  return [
    /No module named '?(pytest|unittest)\b/,
    /\bcommand not found\b/,
    /\bspawn \S+ ENOENT\b/,
    /is not recognized as an internal or external command/,
    /\b(npm|yarn|pnpm)( ERR!| error)? Missing script\b/i,
    /sh: \d+: \S+: not found/,
  ].some((pattern) => pattern.test(output));
}
