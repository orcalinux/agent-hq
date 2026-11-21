import { describe, expect, it } from 'vitest';
import { parallelLimit, planNextWave, type SchedulableTask } from '../../src/engine/scheduler';

const task = (id: string, agent: string, dependsOn: string[] = [], status = 'pending'): SchedulableTask => ({
  id,
  title: id,
  status,
  assignedAgentId: agent,
  dependsOn,
});

const ids = (tasks: SchedulableTask[]) => tasks.map((t) => t.id);

describe('planNextWave', () => {
  it('reads the parallel setting: default 3, 0 means no limit', () => {
    expect(parallelLimit(undefined)).toBe(3);
    expect(parallelLimit(5)).toBe(5);
    expect(parallelLimit(0)).toBe(Number.POSITIVE_INFINITY);
  });

  it('starts every ready task with no limit, still one per agent', () => {
    const tasks = Array.from({ length: 12 }, (_, i) => task(`t${i}`, `a${i % 10}`));
    expect(planNextWave(tasks, new Set(), parallelLimit(0)).start).toHaveLength(10);
    expect(planNextWave(tasks, new Set(), parallelLimit(4)).start).toHaveLength(4);
  });

  it('starts independent tasks together but never two for the same agent', () => {
    const tasks = [task('a', 'x'), task('b', 'y'), task('c', 'x'), task('d', 'z', ['a'])];
    expect(ids(planNextWave(tasks, new Set()).start)).toEqual(['a', 'b']);
  });

  it('respects the parallel limit and running tasks', () => {
    const tasks = [task('a', 'x', [], 'in_progress'), task('b', 'y'), task('c', 'z'), task('d', 'w')];
    expect(ids(planNextWave(tasks, new Set(['a']), 2).start)).toEqual(['b']);
  });

  it('waits for dependencies and starts them once completed', () => {
    const tasks = [task('a', 'x', [], 'completed'), task('b', 'y', ['a']), task('c', 'z', ['b'])];
    expect(ids(planNextWave(tasks, new Set()).start)).toEqual(['b']);
  });

  it('blocks tasks whose dependency failed, transitively', () => {
    const tasks = [task('a', 'x', [], 'failed'), task('b', 'y', ['a']), task('c', 'z', ['b']), task('d', 'w')];
    const wave = planNextWave(tasks, new Set());
    expect(ids(wave.blocked.map((b) => b.task))).toEqual(['b', 'c']);
    expect(ids(wave.start)).toEqual(['d']);
  });

  it('reruns tasks rejected by QA', () => {
    expect(ids(planNextWave([task('a', 'x', [], 'rejected')], new Set()).start)).toEqual(['a']);
  });
});
