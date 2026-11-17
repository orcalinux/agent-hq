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

const PRIMARY: NavItem[] = [
  { id: 'workspace', label: 'Workspace', icon: Code2, shortcut: 'Alt+1' },
  { id: 'agents', label: 'Agents', icon: Bot, shortcut: 'Alt+2' },
  { id: 'tasks', label: 'Tasks', icon: KanbanSquare, shortcut: 'Alt+3' },
  { id: 'reports', label: 'Reports', icon: FileBarChart, shortcut: 'Alt+4' },
];

const SECONDARY: NavItem[] = [
  { id: 'connections', label: 'Connections', icon: Plug, shortcut: 'Alt+5' },
  { id: 'settings', label: 'Settings', icon: Settings, shortcut: 'Ctrl+,' },
];

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
        'relative flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors',
        active ? 'bg-surface-3 text-fg' : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
        collapsed && 'justify-center px-0'
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {collapsed ? <span className="sr-only">{item.label}</span> : <span className="truncate">{item.label}</span>}
      {badge ? <StatusDot tone={badge === 'ok' ? 'success' : 'warning'} className={cn(collapsed ? 'absolute right-1.5 top-1.5' : 'ml-auto')} /> : null}
    </button>
  );
}

export function Sidebar() {
  const activeView = useAgentStore((s) => s.activeView);
  const theme = useAgentStore((s) => s.themeMode);
  const toggleTheme = useAgentStore((s) => s.toggleThemeMode);
  const collapsed = useLayoutStore((s) => s.sidebarCollapsed);
  const toggle = useLayoutStore((s) => s.toggle);
  const connected = useConnectionsStore((s) => s.providers.some((p) => p.connection));
  const loaded = useConnectionsStore((s) => s.loaded);

  return (
    <nav aria-label="Primary" className={cn('flex shrink-0 flex-col border-r border-line bg-surface p-1.5', collapsed ? 'w-12' : 'w-52')}>
      <div className={cn('mb-1.5 flex h-8 items-center gap-2 px-2', collapsed && 'justify-center px-0')}>
        <img src="/logo.svg" alt="" className="h-6 w-6 shrink-0" />
        {!collapsed && <span className="text-[13px] font-semibold tracking-tight">Agent HQ</span>}
      </div>
      <div className="mb-2">
        <ProjectSwitcher collapsed={collapsed} />
      </div>
      <div className="space-y-0.5">
        {PRIMARY.map((item) => (
          <NavButton key={item.id} item={item} collapsed={collapsed} active={activeView === item.id} />
        ))}
      </div>
      <div className="mt-auto space-y-0.5 border-t border-line pt-1.5">
        {SECONDARY.map((item) => (
          <NavButton
            key={item.id}
            item={item}
            collapsed={collapsed}
            active={activeView === item.id}
            badge={item.id === 'connections' && loaded ? (connected ? 'ok' : 'warn') : null}
          />
        ))}
        <button
          type="button"
          onClick={toggleTheme}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          className={cn('flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] text-fg-muted hover:bg-surface-2 hover:text-fg', collapsed && 'justify-center px-0')}
        >
          {theme === 'dark' ? <Sun className="h-4 w-4 shrink-0" /> : <Moon className="h-4 w-4 shrink-0" />}
          {collapsed ? <span className="sr-only">Toggle theme</span> : <span>{theme === 'dark' ? 'Light theme' : 'Dark theme'}</span>}
        </button>
        <button
          type="button"
          onClick={() => toggle('sidebarCollapsed')}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn('flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] text-fg-subtle hover:bg-surface-2 hover:text-fg', collapsed && 'justify-center px-0')}
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </nav>
  );
}
