import { describe, expect, it } from 'vitest';
import { agentGrowth, focusAreas, lessonWeight, levelFor, weeklyLessons } from '../../src/engine/growth';
import { makeTraySnapshot } from '../../src/desktop/traySnapshot';
import { DEFAULT_AGENTS } from '../../src/store/defaultState';
import type { AgentProfile, Lesson } from '../../src/types';

const NOW = Date.UTC(2026, 10, 20);
const DAY = 24 * 3600 * 1000;
let n = 0;
const lesson = (over: Partial<Lesson>): Lesson => ({
  id: `l${n++}`,
  agentId: 'agent-frontend',
  kind: 'convention',
  text: 'Use Tailwind classes for buttons.',
  source: 'reflection',
  createdAt: NOW - DAY,
  updatedAt: NOW - DAY,
  reinforced: 0,
  uses: 0,
  ...over,
});

describe('agent growth', () => {
  it('weights confirmed, used and pinned lessons more, with caps', () => {
    expect(lessonWeight(lesson({}))).toBe(1);
    expect(lessonWeight(lesson({ reinforced: 2, uses: 5, pinned: true }))).toBe(3.5);
    expect(lessonWeight(lesson({ reinforced: 100, uses: 100 }))).toBe(6);
  });

  it('maps scores to levels with progress toward the next one', () => {
    expect(levelFor(0)).toMatchObject({ name: 'Newcomer', next: 'Learning', toNext: 3, progress: 0 });
    expect(levelFor(6.5)).toMatchObject({ name: 'Learning', next: 'Practiced', toNext: 3.5, progress: 50 });
    expect(levelFor(25)).toMatchObject({ name: 'Skilled', next: 'Expert' });
    expect(levelFor(80)).toMatchObject({ name: 'Expert', next: undefined, toNext: 0, progress: 100 });
  });

  it('finds the subjects lessons keep returning to and ignores filler words', () => {
    const areas = focusAreas([
      lesson({ text: 'Use Tailwind classes, never inline styles on buttons.' }),
      lesson({ text: 'Buttons must use the shared Tailwind tokens.', reinforced: 2 }),
      lesson({ text: 'Database migrations live in db/migrations.' }),
      lesson({ text: 'Run migrations before seeding the database.' }),
    ]).map((a) => a.term);
    expect(areas.slice(0, 2)).toEqual(['button', 'tailwind']);
    expect(areas).toContain('migration');
    expect(areas).toContain('database');
    expect(areas).not.toContain('use');
    expect(areas).not.toContain('the');
    expect(focusAreas([])).toEqual([]);
    expect(focusAreas([lesson({ text: 'Database migrations live in db/migrations.' })])).toEqual([]);
  });

  it('buckets lessons by week, oldest first, and ignores older and future ones', () => {
    const weeks = weeklyLessons([
      lesson({ createdAt: NOW - DAY }),
      lesson({ createdAt: NOW - 2 * DAY }),
      lesson({ createdAt: NOW - 8 * DAY }),
      lesson({ createdAt: NOW - 60 * DAY }),
      lesson({ createdAt: NOW + DAY }),
    ], NOW);
    expect(weeks).toEqual([0, 0, 0, 0, 0, 0, 1, 2]);
  });

  it('combines an agent\'s own lessons and finished tasks, without team or other agents\' lessons', () => {
    const agent: AgentProfile = { ...DEFAULT_AGENTS['agent-frontend'] };
    agent.taskHistory = [
      { runId: 'r', taskId: 't1', title: 'a', status: 'completed', model: 'm', durationMs: 1, tokens: 1, timestamp: 1 },
      { runId: 'r', taskId: 't2', title: 'b', status: 'completed', model: 'm', durationMs: 1, tokens: 1, timestamp: 2 },
      { runId: 'r', taskId: 't3', title: 'c', status: 'failed', model: 'm', durationMs: 1, tokens: 1, timestamp: 3 },
    ];
    const lessons = [
      lesson({ source: 'qa', kind: 'pitfall', reinforced: 1 }),
      lesson({ source: 'user', uses: 5, updatedAt: NOW }),
      lesson({ agentId: 'team' }),
      lesson({ agentId: 'agent-backend' }),
    ];
    const g = agentGrowth(agent, lessons, NOW);
    expect(g.lessons).toHaveLength(2);
    expect(g.score).toBe(1.5 + 2 + 1);
    expect(g.level.name).toBe('Learning');
    expect(g).toMatchObject({ fromFeedback: 1, taughtByYou: 1, reinforced: 1, uses: 5, tasksDone: 2, tasksFailed: 1, successRate: 67, thisWeek: 2 });
    expect(g.kinds).toMatchObject({ pitfall: 1, convention: 1, fact: 0 });
    expect(g.latest?.source).toBe('user');
  });

  it('summarises learning for the tray only when memory has been read', () => {
    const args = [
      { agents: DEFAULT_AGENTS, activeMission: null, activity: [], themeMode: 'dark' },
      { name: 'p', root: '/p' }, [], { busy: 0, running: false, label: 'Idle' }, () => '', () => '',
    ] as const;
    expect(makeTraySnapshot(...args).learning).toBeUndefined();
    expect(makeTraySnapshot(...args, []).learning).toEqual({ lessons: 0, thisWeek: 0 });
    const learning = makeTraySnapshot(...args, [lesson({ createdAt: Date.now(), reinforced: 6, uses: 10 })]).learning;
    expect(learning).toMatchObject({ lessons: 1, thisWeek: 1, top: { name: 'Pulse', level: 'Learning' } });
  });
});
