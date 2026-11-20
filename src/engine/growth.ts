import { LESSON_KINDS, type AgentProfile, type Lesson, type LessonKind, type LessonSource } from '@/types';

const DAY = 24 * 3600 * 1000;
export const WEEKS = 8;

export const LEVELS = [
  { name: 'Newcomer', min: 0 },
  { name: 'Learning', min: 3 },
  { name: 'Practiced', min: 10 },
  { name: 'Skilled', min: 25 },
  { name: 'Expert', min: 50 },
] as const;
export type LevelName = (typeof LEVELS)[number]['name'];

const STOPWORDS = new Set(
  ('the and for are but not you all any can had her was one our out has have him his how its may new now old see two who did get let put say she too use that with this from they will would there their what about which when make like time just know take into your some could them than then look only come over also back after work first well even want because these give most should must never always every before run runs file files code project agent agents task tasks using used when where while does done each other only very really such been being here more less same instead without within keep need needs make sure don dont isn per live ask add via')
    .split(/\s+/)
);

/** How much a lesson counts toward expertise: confirmed and used lessons count more. */
export function lessonWeight(lesson: Lesson): number {
  return 1 + 0.5 * Math.min(lesson.reinforced, 6) + 0.2 * Math.min(lesson.uses, 10) + (lesson.pinned ? 0.5 : 0);
}

export function levelFor(score: number) {
  let index = 0;
  LEVELS.forEach((l, i) => {
    if (score >= l.min) index = i;
  });
  const level = LEVELS[index];
  const next = LEVELS[index + 1];
  const progress = next ? Math.round(((score - level.min) / (next.min - level.min)) * 100) : 100;
  return { index, name: level.name as LevelName, next: next?.name as LevelName | undefined, toNext: next ? Math.max(0, Math.ceil((next.min - score) * 10) / 10) : 0, progress: Math.max(0, Math.min(100, progress)) };
}

function terms(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9+#]+/)) {
    if (raw.length < 3 || /^\d+$/.test(raw) || STOPWORDS.has(raw)) continue;
    const word = raw.length > 4 && raw.endsWith('s') && !raw.endsWith('ss') ? raw.slice(0, -1) : raw;
    if (!STOPWORDS.has(word)) out.add(word);
  }
  return out;
}

/** The subjects at least two of an agent's lessons come back to, weighted by how much each lesson counts. */
export function focusAreas(lessons: Lesson[], limit = 5): Array<{ term: string; weight: number }> {
  const weights = new Map<string, number>();
  for (const lesson of lessons) {
    const w = lessonWeight(lesson);
    for (const term of terms(lesson.text)) weights.set(term, (weights.get(term) ?? 0) + w);
  }
  const counts = new Map<string, number>();
  for (const lesson of lessons) for (const term of terms(lesson.text)) counts.set(term, (counts.get(term) ?? 0) + 1);
  return [...weights.entries()]
    .filter(([term]) => (counts.get(term) ?? 0) >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, weight]) => ({ term, weight: Math.round(weight * 10) / 10 }));
}

/** Lessons learned in each of the last `weeks` weeks, oldest first. */
export function weeklyLessons(lessons: Lesson[], now = Date.now(), weeks = WEEKS): number[] {
  const buckets = new Array<number>(weeks).fill(0);
  for (const lesson of lessons) {
    const age = Math.floor((now - lesson.createdAt) / (7 * DAY));
    if (age >= 0 && age < weeks) buckets[weeks - 1 - age] += 1;
  }
  return buckets;
}

export const FEEDBACK_SOURCES: LessonSource[] = ['qa', 'mentor', 'verification'];

export interface AgentGrowth {
  agent: AgentProfile;
  lessons: Lesson[];
  score: number;
  level: ReturnType<typeof levelFor>;
  kinds: Record<LessonKind, number>;
  fromFeedback: number;
  taughtByYou: number;
  reinforced: number;
  uses: number;
  tasksDone: number;
  tasksFailed: number;
  successRate?: number;
  focus: Array<{ term: string; weight: number }>;
  weekly: number[];
  thisWeek: number;
  latest?: Lesson;
}

/** Expertise of one agent from its own lessons and finished tasks. */
export function agentGrowth(agent: AgentProfile, all: Lesson[], now = Date.now()): AgentGrowth {
  const lessons = all.filter((l) => l.agentId === agent.id);
  const kinds = Object.fromEntries(LESSON_KINDS.map((k) => [k, 0])) as Record<LessonKind, number>;
  lessons.forEach((l) => (kinds[l.kind] += 1));
  const tasksDone = agent.taskHistory.filter((t) => t.status === 'completed').length;
  const tasksFailed = agent.taskHistory.filter((t) => t.status === 'failed').length;
  const score = Math.round((lessons.reduce((n, l) => n + lessonWeight(l), 0) + 0.5 * tasksDone) * 10) / 10;
  const weekly = weeklyLessons(lessons, now);
  return {
    agent,
    lessons,
    score,
    level: levelFor(score),
    kinds,
    fromFeedback: lessons.filter((l) => FEEDBACK_SOURCES.includes(l.source)).length,
    taughtByYou: lessons.filter((l) => l.source === 'user').length,
    reinforced: lessons.reduce((n, l) => n + l.reinforced, 0),
    uses: lessons.reduce((n, l) => n + l.uses, 0),
    tasksDone,
    tasksFailed,
    successRate: tasksDone + tasksFailed ? Math.round((tasksDone / (tasksDone + tasksFailed)) * 100) : undefined,
    focus: focusAreas(lessons),
    weekly,
    thisWeek: weekly[weekly.length - 1],
    latest: lessons.reduce<Lesson | undefined>((best, l) => (!best || l.updatedAt > best.updatedAt ? l : best), undefined),
  };
}
