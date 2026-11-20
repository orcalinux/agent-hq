import { create } from 'zustand';
import { api } from '@/api/client';
import type { EmbeddingStatus, Lesson, LessonInput, MemorySearchMode } from '@/types';
import { useWorkspaceStore } from './useWorkspaceStore';

interface MemoryState {
  lessons: Lesson[];
  file: string;
  /** Set when the project's memory file cannot be read; nothing is written over it. */
  error: string | null;
  loaded: boolean;
  status: { embedding: EmbeddingStatus; mode: MemorySearchMode } | null;
  load: () => Promise<void>;
  loadStatus: () => Promise<void>;
  add: (inputs: LessonInput[]) => Promise<{ added: Lesson[]; reinforced: Lesson[] }>;
  update: (id: string, patch: Partial<Pick<Lesson, 'text' | 'kind' | 'agentId' | 'pinned'>>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setEmbeddingModel: (model: string) => Promise<void>;
  setStatus: (status: { embedding: EmbeddingStatus; mode: MemorySearchMode }) => void;
}

export const useMemoryStore = create<MemoryState>()((set, get) => ({
  lessons: [],
  file: '.agent-hq/memory/lessons.json',
  error: null,
  loaded: false,
  status: null,
  load: async () => {
    try {
      const res = await api.memory();
      set({ lessons: res.lessons, file: res.file, error: res.error ?? null, loaded: true });
    } catch (err) {
      set({ error: (err as Error).message, loaded: true });
    }
  },
  loadStatus: async () => {
    try {
      set({ status: await api.memoryStatus() });
    } catch {
      set({ status: null });
    }
  },
  add: async (inputs) => {
    const res = await api.addLessons(inputs);
    await get().load();
    return res;
  },
  update: async (id, patch) => {
    const { lesson } = await api.updateLesson(id, patch);
    set((s) => ({ lessons: s.lessons.map((l) => (l.id === id ? lesson : l)) }));
  },
  remove: async (id) => {
    await api.deleteLesson(id);
    set((s) => ({ lessons: s.lessons.filter((l) => l.id !== id) }));
  },
  setEmbeddingModel: async (model) => {
    set({ status: await api.setEmbeddingModel(model) });
  },
  setStatus: (status) => set({ status }),
}));

let lastRoot: string | null = null;
useWorkspaceStore.subscribe((s) => {
  if (!s.root || s.root === lastRoot) return;
  lastRoot = s.root;
  void useMemoryStore.getState().load();
});

/** Lessons per agent and in total, for progress displays. */
export function memoryStats(lessons: Lesson[], agentId?: string) {
  const mine = agentId ? lessons.filter((l) => l.agentId === agentId) : lessons;
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  return {
    count: mine.length,
    reinforced: mine.reduce((n, l) => n + l.reinforced, 0),
    uses: mine.reduce((n, l) => n + l.uses, 0),
    thisWeek: mine.filter((l) => l.createdAt >= weekAgo).length,
    lastLearnedAt: mine.reduce((n, l) => Math.max(n, l.updatedAt), 0) || undefined,
  };
}
