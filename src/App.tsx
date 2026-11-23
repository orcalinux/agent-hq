import { lazy, Suspense, useEffect } from 'react';
import { Sidebar } from '@/components/shell/Sidebar';
import { StatusBar } from '@/components/shell/StatusBar';
import { ActivityPanel } from '@/components/shell/ActivityPanel';
import { CommandPalette } from '@/components/shell/CommandPalette';
import { ErrorBoundary } from '@/components/shell/ErrorBoundary';
import { TitleBar } from '@/components/shell/TitleBar';
import { WhatsNewDialog } from '@/components/shell/WhatsNewDialog';
import { UpdateCenter } from '@/components/shell/UpdateCenter';
import { AboutDialog } from '@/components/shell/AboutDialog';
import { useShortcuts } from '@/components/shell/useShortcuts';
import { OverflowTooltipHost } from '@/components/ui/OverflowTooltip';
import { Spinner } from '@/components/ui/primitives';
import { WorkspaceView } from '@/components/workspace/WorkspaceView';
import { useAgentStore } from '@/store/useAgentStore';
import { useConnectionsStore } from '@/store/useConnectionsStore';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { useLayoutStore } from '@/store/useLayoutStore';
import { useModelWatchStore } from '@/store/useModelWatchStore';
import { isCheckDue } from '@/engine/modelWatch';

const AgentsView = lazy(() => import('@/components/agents/AgentsView'));
const TasksView = lazy(() => import('@/components/tasks/TasksView'));
const ReportsView = lazy(() => import('@/components/reports/ReportsView'));
const GrowthView = lazy(() => import('@/components/growth/GrowthView'));
const ConnectionsView = lazy(() => import('@/components/connections/ConnectionsView'));
const SettingsView = lazy(() => import('@/components/settings/SettingsView'));

export default function App() {
  const activeView = useAgentStore((s) => s.activeView);
  const activityOpen = useLayoutStore((s) => s.activityOpen);
  useShortcuts();

  useEffect(() => {
    const checkIfDue = () => {
      const watch = useModelWatchStore.getState();
      if (isCheckDue(watch.lastCheckedAt, watch.intervalHours)) void watch.check();
    };
    const connections = useConnectionsStore.getState().load().then(checkIfDue);
    void useConnectionsStore.getState().detect();
    const workspace = useWorkspaceStore.getState().load();
    void Promise.allSettled([connections, workspace])
      .then(() => import('@/engine/runJournal'))
      .then(async (journal) => {
        await journal.restoreFromJournal();
        journal.startRunJournal();
      })
      .then(() => import('@/engine/liveOrchestrator'))
      .then((m) => m.resumeInterruptedRun());
    const timer = window.setInterval(checkIfDue, 10 * 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="flex h-full flex-col bg-canvas text-fg">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col" aria-label={activeView}>
          <ErrorBoundary key={activeView} scope={activeView.charAt(0).toUpperCase() + activeView.slice(1)}>
            {activeView === 'workspace' ? (
              <WorkspaceView />
            ) : (
              <Suspense fallback={<div data-view-loading="" className="flex h-full items-center justify-center"><Spinner /></div>}>
                {activeView === 'agents' && <AgentsView />}
                {activeView === 'tasks' && <TasksView />}
                {activeView === 'reports' && <ReportsView />}
                {activeView === 'growth' && <GrowthView />}
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
      <WhatsNewDialog />
      <UpdateCenter />
      <AboutDialog />
      <OverflowTooltipHost />
    </div>
  );
}
