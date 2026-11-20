export const LESSON_KINDS = ['convention', 'pitfall', 'decision', 'preference', 'fact'] as const;
export type LessonKind = (typeof LESSON_KINDS)[number];
export type LessonSource = 'qa' | 'mentor' | 'verification' | 'reflection' | 'user';

/** Lessons tagged "team" apply to every agent. */
export const TEAM_MEMORY = 'team';

export interface Lesson {
  id: string;
  agentId: string;
  kind: LessonKind;
  text: string;
  source: LessonSource;
  runId?: string;
  taskId?: string;
  createdAt: number;
  updatedAt: number;
  reinforced: number;
  uses: number;
  lastUsedAt?: number;
  pinned?: boolean;
}

export interface LessonInput {
  agentId: string;
  kind: LessonKind;
  text: string;
  source: LessonSource;
  runId?: string;
  taskId?: string;
}

export interface EmbeddingStatus {
  endpoint: string;
  reachable: boolean;
  preference: string;
  installed: string[];
  active?: string;
  recommended: string;
  error?: string;
}

export type MemorySearchMode = 'keyword' | 'hybrid';

export interface MemorySearchHit {
  lesson: Lesson;
  score: number;
  matchedBy: Array<'keyword' | 'meaning'>;
}

/** When agents write lessons: after every run, only after review feedback, or never. */
export type LearningMode = 'every-run' | 'feedback' | 'off';

export const LESSON_KIND_LABEL: Record<LessonKind, string> = {
  convention: 'Convention',
  pitfall: 'Pitfall',
  decision: 'Decision',
  preference: 'Preference',
  fact: 'Fact',
};

export const LESSON_SOURCE_LABEL: Record<LessonSource, string> = {
  qa: 'QA review',
  mentor: 'Mentor review',
  verification: 'Verification',
  reflection: 'Run reflection',
  user: 'Taught by you',
};
