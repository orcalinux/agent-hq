import { Activity, GitBranch, Search } from 'lucide-react';
import { useAgentStore } from '@/store/useAgentStore';
import { useConnectionsStore } from '@/store/useConnectionsStore';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { useLayoutStore } from '@/store/useLayoutStore';
import { Kbd, StatusDot } from '@/components/ui/primitives';
import { isBusy } from '@/components/ui/helpers';

export function StatusBar() {
  const workspaceName = useWorkspaceStore((s) => s.name);
  const branch = useWorkspaceStore((s) => s.git?.branch);
  const connectedCount = useConnectionsStore((s) => s.providers.filter((p) => p.connection).length);
  const modelCount = useConnectionsStore((s) => s.providers.reduce((n, p) => n + (p.connection ? p.models.length : 0), 0));
  const mission = useAgentStore((s) => s.activeMission);
  const busyAgents = useAgentStore((s) => Object.values(s.agents).filter((a) => isBusy(a.status)).length);
  const toggle = useLayoutStore((s) => s.toggle);
  const activityOpen = useLayoutStore((s) => s.activityOpen);
  const setPalette = useAgentStore((s) => s.setCommandPaletteOpen);
  const setView = useAgentStore((s) => s.setActiveView);

  const running = mission?.status === 'running' || mission?.status === 'qa_loopback';
  const done = mission ? mission.tasks.filter((t) => t.status === 'completed').length : 0;

  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-line bg-surface px-2.5 text-[11.5px] text-fg-muted">
      <span className="truncate" title="Workspace folder">{workspaceName || 'No workspace'}</span>
      {branch ? (
        <span className="flex items-center gap-1"><GitBranch className="h-3 w-3" />{branch}</span>
      ) : null}
      <button type="button" onClick={() => setView('connections')} className="flex items-center gap-1.5 hover:text-fg" title="Open Connections & Models">
        <StatusDot tone={connectedCount ? 'success' : 'warning'} />
        {connectedCount ? `${connectedCount} provider${connectedCount === 1 ? '' : 's'} · ${modelCount} models` : 'No AI provider connected'}
      </button>
      <div className="ml-auto flex items-center gap-3">
        <button
          type="button"
          onClick={() => toggle('activityOpen')}
          aria-pressed={activityOpen}
          className="flex items-center gap-1.5 hover:text-fg"
          title="Toggle activity monitor"
        >
          <Activity className="h-3 w-3" />
          {running && mission ? (
            <>
              <StatusDot tone="accent" pulse />
              <span>
                {mission.source === 'simulation' ? 'Demo' : 'Run'} · {done}/{mission.tasks.length} tasks
                {busyAgents ? ` · ${busyAgents} active` : ''}
              </span>
            </>
          ) : (
            <span>Activity</span>
          )}
        </button>
        <button type="button" onClick={() => setPalette(true)} className="flex items-center gap-1.5 hover:text-fg" title="Command palette">
          <Search className="h-3 w-3" />
          <Kbd>Ctrl K</Kbd>
        </button>
      </div>
    </footer>
  );
}
