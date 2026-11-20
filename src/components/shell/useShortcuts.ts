import { useEffect } from 'react';
import { useAgentStore } from '@/store/useAgentStore';
import { useLayoutStore } from '@/store/useLayoutStore';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import type { ViewMode } from '@/types';
import { openIntegratedTerminal } from '@/utils/terminalActions';

const ALT_VIEWS: Record<string, ViewMode> = { '1': 'workspace', '2': 'agents', '3': 'tasks', '4': 'reports', '5': 'connections' };

export const SHORTCUTS: Array<{ keys: string; action: string }> = [
  { keys: 'Ctrl/Cmd+K', action: 'Command palette' },
  { keys: 'Alt+1…5', action: 'Workspace, Agents, Tasks, Reports, Connections' },
  { keys: 'Ctrl/Cmd+,', action: 'Settings' },
  { keys: 'Ctrl/Cmd+B', action: 'Toggle explorer' },
  { keys: 'Ctrl/Cmd+J', action: 'Toggle bottom panel' },
  { keys: 'Ctrl/Cmd+L', action: 'Focus orchestrator chat' },
  { keys: 'Ctrl/Cmd+`', action: 'Open the integrated terminal' },
  { keys: 'Ctrl/Cmd+S', action: 'Save active file' },
  { keys: 'Esc', action: 'Close palette, dialog or details panel' },
];

export function useShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const agent = useAgentStore.getState();
      const layout = useLayoutStore.getState();
      const key = e.key.toLowerCase();
      const inTerminal = e.target instanceof Element && Boolean(e.target.closest('.agent-hq-terminal'));

      if (mod && (e.key === '`' || e.code === 'Backquote')) {
        e.preventDefault();
        openIntegratedTerminal();
      } else if (inTerminal && !(mod && e.shiftKey)) {
        return;
      } else if (mod && key === 'k') {
        e.preventDefault();
        agent.setCommandPaletteOpen(!agent.isCommandPaletteOpen);
      } else if (e.altKey && !mod && ALT_VIEWS[e.key]) {
        e.preventDefault();
        agent.setActiveView(ALT_VIEWS[e.key]);
      } else if (mod && e.key === ',') {
        e.preventDefault();
        agent.setActiveView('settings');
      } else if (mod && key === 'b') {
        e.preventDefault();
        agent.setActiveView('workspace');
        layout.toggle('explorerVisible');
      } else if (mod && key === 'j') {
        e.preventDefault();
        agent.setActiveView('workspace');
        layout.toggle('bottomVisible');
      } else if (mod && key === 'l') {
        e.preventDefault();
        agent.setActiveView('workspace');
        if (!layout.chatVisible) layout.toggle('chatVisible');
        requestAnimationFrame(() => document.getElementById('orchestrator-input')?.focus());
      } else if (mod && key === 's') {
        const ws = useWorkspaceStore.getState();
        if (agent.activeView === 'workspace' && ws.activePath) {
          e.preventDefault();
          void ws.saveFile(ws.activePath);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
