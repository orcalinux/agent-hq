import { lazy, Suspense, useEffect } from 'react';
import { Sidebar } from '@/components/shell/Sidebar';
import { StatusBar } from '@/components/shell/StatusBar';
import { ActivityPanel } from '@/components/shell/ActivityPanel';
import { CommandPalette } from '@/components/shell/CommandPalette';
import { ErrorBoundary } from '@/components/shell/ErrorBoundary';
import { useShortcuts } from '@/components/shell/useShortcuts';
import { Spinner } from '@/components/ui/primitives';
import { WorkspaceView } from '@/components/workspace/WorkspaceView';
import { useAgentStore } from '@/store/useAgentStore';
import { useConnectionsStore } from '@/store/useConnectionsStore';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { useLayoutStore } from '@/store/useLayoutStore';

const AgentsView = lazy(() => import('@/components/agents/AgentsView'));
const TasksView = lazy(() => import('@/components/tasks/TasksView'));
const ReportsView = lazy(() => import('@/components/reports/ReportsView'));
const ConnectionsView = lazy(() => import('@/components/connections/ConnectionsView'));
const SettingsView = lazy(() => import('@/components/settings/SettingsView'));

export default function App() {
  const activeView = useAgentStore((s) => s.activeView);
  const activityOpen = useLayoutStore((s) => s.activityOpen);
  useShortcuts();

  useEffect(() => {
    void useConnectionsStore.getState().load();
    void useConnectionsStore.getState().detect();
    void useWorkspaceStore.getState().load();
  }, []);

  return (
    <div className="flex h-full flex-col bg-canvas text-fg">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col" aria-label={activeView}>
          <ErrorBoundary key={activeView} scope={activeView.charAt(0).toUpperCase() + activeView.slice(1)}>
            {activeView === 'workspace' ? (
              <WorkspaceView />
            ) : (
              <Suspense fallback={<div className="flex h-full items-center justify-center"><Spinner /></div>}>
                {activeView === 'agents' && <AgentsView />}
                {activeView === 'tasks' && <TasksView />}
                {activeView === 'reports' && <ReportsView />}
                {activeView === 'connections' && <ConnectionsView />}
                {activeView === 'settings' && <SettingsView />}
              </Suspense>
            )}
          </ErrorBoundary>
        </main>
      </div>
      {activityOpen ? <ActivityPanel /> : null}
      <StatusBar />
      <CommandPalette />
    </div>
  );
}
