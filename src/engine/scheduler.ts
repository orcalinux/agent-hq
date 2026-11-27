export interface SchedulableTask {
  id: string;
  title: string;
  status: string;
  assignedAgentId: string;
  dependsOn?: string[];
}

export const MAX_PARALLEL_TASKS = 3;

export function parallelLimit(setting: number | undefined): number {
  if (setting === undefined || !Number.isFinite(setting)) return MAX_PARALLEL_TASKS;
  return setting <= 0 ? Number.POSITIVE_INFINITY : Math.floor(setting);
}

const STARTABLE = new Set(['pending', 'rejected']);
const TERMINAL_FAILURE = new Set(['failed', 'cancelled']);

/**
 * Picks the tasks that can start now: all dependencies completed, their agent is not
 * already working, and the parallel limit is not reached. Tasks whose dependency failed
 * are returned as blocked (including tasks blocked transitively in the same pass).
 */
export function planNextWave<T extends SchedulableTask>(
  tasks: T[],
  running: ReadonlySet<string>,
  limit = MAX_PARALLEL_TASKS,
  filesOf?: (task: T) => string[]
): { start: T[]; blocked: Array<{ task: T; dependency: T }> } {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const busyAgents = new Set(tasks.filter((t) => running.has(t.id)).map((t) => t.assignedAgentId));
  const busyFiles = new Set(tasks.filter((t) => running.has(t.id)).flatMap((t) => filesOf?.(t) ?? []));
  const blockedBy = new Map<string, T>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of tasks) {
      if (running.has(task.id) || !STARTABLE.has(task.status) || blockedBy.has(task.id)) continue;
      const deps = (task.dependsOn ?? []).map((d) => byId.get(d)).filter((d): d is T => Boolean(d));
      const failedDep = deps.find((d) => TERMINAL_FAILURE.has(d.status) || blockedBy.has(d.id));
      if (failedDep) {
        blockedBy.set(task.id, failedDep);
        changed = true;
      }
    }
  }
  const start: T[] = [];
  const blocked: Array<{ task: T; dependency: T }> = [];
  for (const task of tasks) {
    if (running.has(task.id) || !STARTABLE.has(task.status)) continue;
    const failedDep = blockedBy.get(task.id);
    if (failedDep) {
      blocked.push({ task, dependency: failedDep });
      continue;
    }
    const deps = (task.dependsOn ?? []).map((d) => byId.get(d)).filter((d): d is T => Boolean(d));
    if (!deps.every((d) => d.status === 'completed')) continue;
    if (busyAgents.has(task.assignedAgentId) || running.size + start.length >= limit) continue;
    const files = filesOf?.(task) ?? [];
    if (files.some((f) => busyFiles.has(f))) continue;
    busyAgents.add(task.assignedAgentId);
    for (const f of files) busyFiles.add(f);
    start.push(task);
  }
  return { start, blocked };
}
