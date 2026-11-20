import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { safeStorage } from './storage';

export type BottomTab = 'terminal' | 'commands' | 'logs' | 'problems' | 'changes';
export type WorkspaceLayout = 'code' | 'chat';
export type AgentsViewMode = 'list' | 'graph' | 'office';

interface LayoutState {
  sidebarCollapsed: boolean;
  explorerVisible: boolean;
  bottomVisible: boolean;
  chatVisible: boolean;
  workspaceLayout: WorkspaceLayout;
  explorerWidth: number;
  chatWidth: number;
  bottomHeight: number;
  bottomTab: BottomTab;
  agentsView: AgentsViewMode;
  activityOpen: boolean;
  detailWidth: number;
  activityHeight: number;
  graphPositions: Record<string, { x: number; y: number }>;

  set: (patch: Partial<Omit<LayoutState, 'set' | 'toggle' | 'reset'>>) => void;
  toggle: (key: 'sidebarCollapsed' | 'explorerVisible' | 'bottomVisible' | 'chatVisible' | 'activityOpen') => void;
  reset: () => void;
}

const DEFAULTS = {
  sidebarCollapsed: false,
  explorerVisible: true,
  bottomVisible: true,
  chatVisible: true,
  workspaceLayout: 'code' as WorkspaceLayout,
  explorerWidth: 248,
  chatWidth: 400,
  bottomHeight: 220,
  bottomTab: 'terminal' as BottomTab,
  agentsView: 'graph' as AgentsViewMode,
  activityOpen: false,
  detailWidth: 420,
  activityHeight: 240,
  graphPositions: {} as Record<string, { x: number; y: number }>,
};

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      set: (patch) => set(patch),
      toggle: (key) => set((s) => ({ [key]: !s[key] }) as Partial<LayoutState>),
      reset: () => set(DEFAULTS),
    }),
    {
      name: 'agent-hq.layout',
      storage: safeStorage,
      partialize: ({ set: _s, toggle: _t, reset: _r, ...rest }) => rest,
    }
  )
);
