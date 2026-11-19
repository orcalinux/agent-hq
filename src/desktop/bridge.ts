import { isBusy } from '@/components/ui/helpers';
import { api } from '@/api/client';
import { useAgentStore } from '@/store/useAgentStore';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import type { ViewMode } from '@/types';
import type { DesktopApi, DesktopCommand, DesktopStatus } from './types';

const VIEWS: ViewMode[] = ['workspace', 'agents', 'tasks', 'reports', 'connections', 'settings'];

export function desktopApi(): DesktopApi | undefined {
  return typeof window !== 'undefined' ? window.agentHqDesktop : undefined;
}

export function isDesktop(): boolean {
  return Boolean(desktopApi());
}

export function statusFrom(state: ReturnType<typeof useAgentStore.getState>): DesktopStatus {
  const busy = Object.values(state.agents).filter((a) => isBusy(a.status)).length;
  const mission = state.activeMission;
  const running = state.isLiveRunning || mission?.status === 'running' || mission?.status === 'qa_loopback';
  let label = 'Idle';
  if (running) {
    const done = mission?.tasks.filter((t) => t.status === 'completed').length ?? 0;
    const total = mission?.tasks.length ?? 0;
    label = `${busy} agent${busy === 1 ? '' : 's'} working` + (total ? ` · ${done}/${total} tasks` : '');
  } else if (mission?.status === 'completed') label = 'Last run finished';
  else if (mission?.status === 'failed') label = 'Last run failed';
  return { busy, label, running };
}

function handleCommand(command: DesktopCommand): void {
  const store = useAgentStore.getState();
  switch (command.type) {
    case 'navigate':
      if (VIEWS.includes(command.view)) store.setActiveView(command.view);
      break;
    case 'open-project':
      store.setActiveView('workspace');
      void useWorkspaceStore.getState().setRoot(command.path);
      break;
    case 'command-palette':
      store.setCommandPaletteOpen(true);
      break;
    case 'toggle-theme':
      store.toggleThemeMode();
      break;
    case 'open-terminal':
      void api.openTerminal().catch(() => undefined);
      break;
  }
}

function windowInBackground(): boolean {
  return document.hidden || !document.hasFocus();
}

/** Connects the app to the desktop shell: tray status, notifications and menu commands. No-op in a browser. */
export function installDesktopBridge(): () => void {
  const api = desktopApi();
  if (!api) return () => {};
  document.documentElement.dataset.desktop = api.platform;

  const offCommand = api.onCommand(handleCommand);

  let lastStatus = '';
  let lastTheme = '';
  let lastMissionStatus = useAgentStore.getState().activeMission?.status;
  const notifiedPlans = new Set<string>();
  for (const m of useAgentStore.getState().managerChatMessages) if (m.plan?.status === 'proposed') notifiedPlans.add(m.id);

  const publish = (state: ReturnType<typeof useAgentStore.getState>) => {
    if (state.themeMode !== lastTheme) {
      lastTheme = state.themeMode;
      api.setTheme(state.themeMode === 'light' ? 'light' : 'dark');
    }
    const status = statusFrom(state);
    const key = JSON.stringify(status);
    if (key !== lastStatus) {
      lastStatus = key;
      api.setStatus(status);
    }

    const mission = state.activeMission;
    if (mission && mission.status !== lastMissionStatus) {
      if (windowInBackground()) {
        if (mission.status === 'completed') {
          const changes = mission.proposedChanges?.filter((c) => c.status === 'pending').length ?? 0;
          api.notify('Run finished', `${mission.title}${changes ? ` · ${changes} change${changes === 1 ? '' : 's'} ready to review` : ''}`);
        } else if (mission.status === 'failed') {
          api.notify('Run failed', mission.error || mission.title);
        }
      }
    }
    lastMissionStatus = mission?.status;

    for (const m of state.managerChatMessages) {
      if (m.plan?.status !== 'proposed' || notifiedPlans.has(m.id)) continue;
      notifiedPlans.add(m.id);
      if (windowInBackground()) {
        const n = m.plan.tasks.length;
        api.notify('Plan ready for review', `${n} task${n === 1 ? '' : 's'} · approve it to start the run`);
      }
    }
  };

  publish(useAgentStore.getState());
  const offStore = useAgentStore.subscribe(publish);
  return () => {
    offCommand();
    offStore();
  };
}
