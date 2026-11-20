import { useAgentStore } from '@/store/useAgentStore';
import { useLayoutStore } from '@/store/useLayoutStore';

export const FOCUS_TERMINAL_EVENT = 'agent-hq:focus-terminal';

/** Shows the integrated terminal in the workspace and puts the keyboard focus in it. */
export function openIntegratedTerminal(): void {
  useAgentStore.getState().setActiveView('workspace');
  useLayoutStore.getState().set({ bottomVisible: true, bottomTab: 'terminal', workspaceLayout: 'code' });
  setTimeout(() => window.dispatchEvent(new Event(FOCUS_TERMINAL_EVENT)), 60);
}
