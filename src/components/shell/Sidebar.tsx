import { Bot, ChevronsLeft, ChevronsRight, Code2, FileBarChart, KanbanSquare, Moon, Plug, Settings, Sun, type LucideIcon } from 'lucide-react';
import { useAgentStore } from '@/store/useAgentStore';
import { useLayoutStore } from '@/store/useLayoutStore';
import { useConnectionsStore } from '@/store/useConnectionsStore';
import { cn } from '@/utils/cn';
import type { ViewMode } from '@/types';
import { StatusDot } from '@/components/ui/primitives';
import { ProjectSwitcher } from './ProjectSwitcher';

interface NavItem {
  id: ViewMode;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
}

const GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: 'Work',
    items: [
      { id: 'workspace', label: 'Workspace', icon: Code2, shortcut: 'Alt+1' },
      { id: 'agents', label: 'Agents', icon: Bot, shortcut: 'Alt+2' },
      { id: 'tasks', label: 'Tasks', icon: KanbanSquare, shortcut: 'Alt+3' },
    ],
  },
  { label: 'Insights', items: [{ id: 'reports', label: 'Reports', icon: FileBarChart, shortcut: 'Alt+4' }] },
  { label: 'Models', items: [{ id: 'connections', label: 'Connections', icon: Plug, shortcut: 'Alt+5' }] },
];

const SETTINGS: NavItem = { id: 'settings', label: 'Settings', icon: Settings, shortcut: 'Ctrl+,' };

function NavButton({ item, collapsed, active, badge }: { item: NavItem; collapsed: boolean; active: boolean; badge?: 'ok' | 'warn' | null }) {
  const setView = useAgentStore((s) => s.setActiveView);
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={() => setView(item.id)}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? `${item.label}${item.shortcut ? ` (${item.shortcut})` : ''}` : item.shortcut}
      className={cn(
        'relative flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors',
        active ? 'ahq-nav-active font-medium text-fg' : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
        collapsed && 'justify-center px-0'
      )}
    >
      <Icon className={cn('h-4 w-4 shrink-0', active && 'text-accent')} />
      {collapsed ? <span className="sr-only">{item.label}</span> : <span className="truncate">{item.label}</span>}
      {badge ? <StatusDot tone={badge === 'ok' ? 'success' : 'warning'} className={cn(collapsed ? 'absolute right-1.5 top-1.5' : 'ml-auto')} /> : null}
    </button>
  );
}

export function Sidebar() {
  const activeView = useAgentStore((s) => s.activeView);
  const theme = useAgentStore((s) => s.themeMode);
  const toggleTheme = useAgentStore((s) => s.toggleThemeMode);
  const setView = useAgentStore((s) => s.setActiveView);
  const mission = useAgentStore((s) => s.activeMission);
  const collapsed = useLayoutStore((s) => s.sidebarCollapsed);
  const toggle = useLayoutStore((s) => s.toggle);
  const providerCount = useConnectionsStore((s) => s.providers.filter((p) => p.connection).length);
  const modelCount = useConnectionsStore((s) => s.providers.reduce((n, p) => n + (p.connection ? p.models.length : 0), 0));
  const magpie = useConnectionsStore((s) => s.providers.some((p) => p.id === 'magpie' && p.connection));
  const loaded = useConnectionsStore((s) => s.loaded);
  const connected = providerCount > 0;
  const running = mission?.status === 'running' || mission?.status === 'qa_loopback';
  const done = mission ? mission.tasks.filter((t) => t.status === 'completed').length : 0;
  const footer = running
    ? { tone: 'accent' as const, pulse: true, text: `Running · ${done}/${mission!.tasks.length} tasks` }
    : !loaded
      ? { tone: 'neutral' as const, pulse: false, text: 'Checking providers…' }
      : connected
        ? { tone: 'success' as const, pulse: false, text: magpie ? `Magpie gateway · ${providerCount} provider${providerCount === 1 ? "" : "s"}` : `${providerCount} provider${providerCount === 1 ? '' : 's'} · ${modelCount} models` }
        : { tone: 'warning' as const, pulse: false, text: 'No provider connected' };

  return (
    <nav aria-label="Primary" className={cn('flex shrink-0 flex-col border-r border-line bg-surface/80 p-2 backdrop-blur', collapsed ? 'w-14' : 'w-56')}>
      <div className={cn('mb-2 flex h-9 items-center gap-2.5 px-1.5', collapsed && 'justify-center px-0')}>
        <img src="/logo.svg" alt="" className="h-7 w-7 shrink-0 drop-shadow-[0_2px_6px_rgba(91,155,255,0.35)]" />
        {!collapsed && <span className="ahq-brand-text text-[14px] font-semibold tracking-tight">Agent HQ</span>}
      </div>
      <div className="mb-3">
        <ProjectSwitcher collapsed={collapsed} />
      </div>
      <div className="space-y-3">
        {GROUPS.map((group) => (
          <div key={group.label} className="space-y-0.5">
            {collapsed ? <div className="mx-2 mb-1 border-t border-line" /> : <div className="px-2.5 pb-0.5 text-[11px] font-medium text-fg-subtle">{group.label}</div>}
            {group.items.map((item) => (
              <NavButton
                key={item.id}
                item={item}
                collapsed={collapsed}
                active={activeView === item.id}
                badge={item.id === 'connections' && loaded ? (connected ? 'ok' : 'warn') : null}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-auto space-y-1 border-t border-line pt-2">
        <div className={cn('flex items-center gap-1', collapsed && 'flex-col')}>
          <div className="min-w-0 flex-1">
            <NavButton item={SETTINGS} collapsed={collapsed} active={activeView === 'settings'} />
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Light theme' : 'Dark theme'}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => toggle('sidebarCollapsed')}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-subtle hover:bg-surface-2 hover:text-fg"
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          </button>
        </div>
        <button
          type="button"
          onClick={() => setView(running ? 'tasks' : 'connections')}
          title={footer.text}
          className={cn('flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11.5px] text-fg-muted hover:bg-surface-2 hover:text-fg', collapsed && 'justify-center px-0')}
        >
          <StatusDot tone={footer.tone} pulse={footer.pulse} />
          {collapsed ? <span className="sr-only">{footer.text}</span> : <span className="truncate">{footer.text}</span>}
        </button>
      </div>
    </nav>
  );
}
