import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api, type ExecuteResult } from '@/api/client';
import type { EditorBuffer, EditorProblemEntry, WorkspaceTreeEntry } from '@/types';
import { languageFromPath } from '@/utils/diffParser';
import { safeStorage } from './storage';

export interface TerminalEntry extends Partial<ExecuteResult> {
  id: string;
  command: string;
  running: boolean;
  startedAt: number;
}

export interface GitInfo {
  isRepo: boolean;
  branch?: string;
  files: Array<{ path: string; status: string; additions?: number; deletions?: number }>;
}

interface WorkspaceState {
  root: string;
  name: string;
  lockedByEnv: boolean;
  recent: string[];
  tree: WorkspaceTreeEntry[];
  truncated: boolean;
  loading: boolean;
  error: string | null;
  buffers: Record<string, EditorBuffer>;
  openTabs: string[];
  activePath: string | null;
  editorMode: 'code' | 'diff';
  problems: EditorProblemEntry[];
  problemsCheckedAt: number | null;
  problemsRunning: boolean;
  terminal: TerminalEntry[];
  git: GitInfo | null;
  /** Content to diff the active file against (e.g. an agent's proposed change). */
  diffTarget: { path: string; content: string; label: string } | null;

  load: () => Promise<void>;
  refreshTree: () => Promise<void>;
  setRoot: (path: string) => Promise<void>;
  createProject: (p: { parent: string; name: string; gitInit: boolean; description?: string }) => Promise<string>;
  openFile: (path: string) => Promise<void>;
  closeTab: (path: string) => void;
  setActive: (path: string) => void;
  editBuffer: (path: string, content: string) => void;
  saveFile: (path: string) => Promise<void>;
  revertFile: (path: string) => void;
  uploadFiles: (files: Array<{ path: string; content: string }>) => Promise<{ saved: string[]; errors: string[] }>;
  runCommand: (command: string) => Promise<TerminalEntry>;
  clearTerminal: () => void;
  runTypeCheck: () => Promise<void>;
  loadGit: () => Promise<void>;
  setEditorMode: (mode: 'code' | 'diff') => void;
  showDiff: (target: { path: string; content: string; label: string } | null) => void;
  writeAndReload: (path: string, content: string) => Promise<void>;
}

export function isDirty(buffer: EditorBuffer | undefined): boolean {
  return Boolean(buffer && !buffer.loading && buffer.content !== buffer.savedContent);
}

const TSC_LINE = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/;

export function parseTscOutput(output: string): EditorProblemEntry[] {
  const problems: EditorProblemEntry[] = [];
  for (const line of output.split('\n')) {
    const m = line.trim().match(TSC_LINE);
    if (!m) continue;
    problems.push({
      id: `${m[1]}:${m[2]}:${m[3]}:${m[5]}:${problems.length}`,
      file: m[1],
      line: Number(m[2]),
      column: Number(m[3]),
      severity: m[4] === 'error' ? 'error' : 'warning',
      rule: m[5],
      message: m[6],
    });
  }
  return problems;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      root: '',
      name: '',
      lockedByEnv: false,
      recent: [],
      tree: [],
      truncated: false,
      loading: false,
      error: null,
      buffers: {},
      openTabs: [],
      activePath: null,
      editorMode: 'code',
      problems: [],
      problemsCheckedAt: null,
      problemsRunning: false,
      terminal: [],
      git: null,
      diffTarget: null,

      load: async () => {
        set({ loading: true, error: null });
        try {
          const info = await api.workspace();
          const changedRoot = get().root && get().root !== info.root;
          set({
            root: info.root,
            name: info.name,
            lockedByEnv: info.lockedByEnv,
            recent: info.recent,
            ...(changedRoot ? { openTabs: [], activePath: null, buffers: {}, problems: [] } : {}),
          });
          await get().refreshTree();
          const tabs = get().openTabs;
          await Promise.all(tabs.map((p) => get().openFile(p)));
          if (tabs.length && !get().activePath) set({ activePath: tabs[0] });
          void get().loadGit();
        } catch (err) {
          set({ error: (err as Error).message });
        } finally {
          set({ loading: false });
        }
      },

      refreshTree: async () => {
        try {
          const data = await api.files();
          set({ tree: data.files, truncated: data.truncated, error: null });
        } catch (err) {
          set({ error: (err as Error).message });
        }
      },

      setRoot: async (path) => {
        await api.setWorkspaceRoot(path);
        set({ openTabs: [], activePath: null, buffers: {}, problems: [], terminal: [], git: null });
        await get().load();
      },

      createProject: async (p) => {
        const res = await api.createProject(p);
        set({ openTabs: [], activePath: null, buffers: {}, problems: [], terminal: [], git: null });
        await get().load();
        return res.git;
      },

      openFile: async (path) => {
        set((s) => ({
          openTabs: s.openTabs.includes(path) ? s.openTabs : [...s.openTabs, path],
          activePath: path,
        }));
        const existing = get().buffers[path];
        if (existing && !existing.error && !existing.loading) return;
        set((s) => ({
          buffers: {
            ...s.buffers,
            [path]: { path, content: '', savedContent: '', language: languageFromPath(path), loading: true },
          },
        }));
        try {
          const file = await api.readFile(path);
          set((s) => ({
            buffers: {
              ...s.buffers,
              [path]: {
                path,
                content: file.content,
                savedContent: file.content,
                language: languageFromPath(path),
                loading: false,
                binary: file.binary,
              },
            },
          }));
        } catch (err) {
          set((s) => ({
            buffers: {
              ...s.buffers,
              [path]: { ...s.buffers[path], loading: false, error: (err as Error).message },
            },
          }));
        }
      },

      closeTab: (path) =>
        set((s) => {
          const idx = s.openTabs.indexOf(path);
          const openTabs = s.openTabs.filter((t) => t !== path);
          const buffers = { ...s.buffers };
          delete buffers[path];
          const activePath =
            s.activePath === path ? (openTabs[Math.min(idx, openTabs.length - 1)] ?? null) : s.activePath;
          return { openTabs, buffers, activePath };
        }),

      setActive: (path) => set({ activePath: path }),

      editBuffer: (path, content) =>
        set((s) => (s.buffers[path] ? { buffers: { ...s.buffers, [path]: { ...s.buffers[path], content } } } : s)),

      saveFile: async (path) => {
        const buffer = get().buffers[path];
        if (!buffer || buffer.loading || buffer.binary) return;
        const content = buffer.content;
        await api.writeFile(path, content);
        set((s) => ({
          buffers: { ...s.buffers, [path]: { ...s.buffers[path], savedContent: content, error: undefined } },
        }));
        void get().loadGit();
      },

      revertFile: (path) =>
        set((s) =>
          s.buffers[path]
            ? { buffers: { ...s.buffers, [path]: { ...s.buffers[path], content: s.buffers[path].savedContent } } }
            : s
        ),

      uploadFiles: async (files) => {
        const result = await api.upload(files);
        await get().refreshTree();
        if (result.saved[0]) await get().openFile(result.saved[0]);
        void get().loadGit();
        return { saved: result.saved, errors: result.errors };
      },

      runCommand: async (command) => {
        const entry: TerminalEntry = {
          id: `term-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          command,
          running: true,
          startedAt: Date.now(),
        };
        set((s) => ({ terminal: [...s.terminal.slice(-99), entry] }));
        let done: TerminalEntry;
        try {
          const result = await api.execute(command, undefined, 300_000);
          done = { ...entry, ...result, running: false };
        } catch (err) {
          done = { ...entry, running: false, ok: false, stderr: (err as Error).message, exitCode: null };
        }
        set((s) => ({ terminal: s.terminal.map((t) => (t.id === entry.id ? done : t)) }));
        return done;
      },

      clearTerminal: () => set({ terminal: [] }),

      runTypeCheck: async () => {
        set({ problemsRunning: true });
        const result = await get().runCommand('npx tsc --noEmit --pretty false');
        const problems = parseTscOutput(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
        set({ problems, problemsCheckedAt: Date.now(), problemsRunning: false });
      },

      loadGit: async () => {
        try {
          set({ git: await api.git() });
        } catch {
          set({ git: null });
        }
      },

      setEditorMode: (mode) => set({ editorMode: mode }),

      showDiff: (target) => set({ diffTarget: target, editorMode: target ? 'diff' : get().editorMode }),

      writeAndReload: async (path, content) => {
        await api.writeFile(path, content);
        set((s) => ({
          buffers: s.buffers[path]
            ? { ...s.buffers, [path]: { ...s.buffers[path], content, savedContent: content } }
            : s.buffers,
        }));
        await get().refreshTree();
        void get().loadGit();
      },
    }),
    {
      name: 'agent-hq.workspace',
      storage: safeStorage,
      partialize: (s) => ({ openTabs: s.openTabs, activePath: s.activePath, root: s.root, editorMode: s.editorMode }),
    }
  )
);
