import { Bot, ChevronsLeft, Code2, FileBarChart, KanbanSquare, Monitor, Moon, Plug, Settings, Sun, type LucideIcon } from 'lucide-react';
import { useAgentStore } from '@/store/useAgentStore';
import { useLayoutStore } from '@/store/useLayoutStore';
import { useConnectionsStore } from '@/store/useConnectionsStore';
import { cn } from '@/utils/cn';
import type { ThemePreference, ViewMode } from '@/types';
import { StatusDot } from '@/components/ui/primitives';
import { ProjectSwitcher } from './ProjectSwitcher';
import { SideLabel } from './SideLabel';

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

const THEME: Record<ThemePreference, { label: string; icon: LucideIcon }> = {
  system: { label: 'System', icon: Monitor },
  light: { label: 'Light', icon: Sun },
  dark: { label: 'Dark', icon: Moon },
};
const NEXT_THEME: Record<ThemePreference, ThemePreference> = { system: 'light', light: 'dark', dark: 'system' };

const ROW = 'relative flex h-8 w-full items-center gap-2.5 rounded-lg px-3 text-[13px] transition-colors';

function NavButton({ item, collapsed, active, badge }: { item: NavItem; collapsed: boolean; active: boolean; badge?: 'ok' | 'warn' | null }) {
  const setView = useAgentStore((s) => s.setActiveView);
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={() => setView(item.id)}
      aria-current={active ? 'page' : undefined}
      aria-label={item.label}
      title={collapsed ? `${item.label}${item.shortcut ? ` (${item.shortcut})` : ''}` : item.shortcut}
      className={cn(ROW, active ? 'ahq-nav-active font-medium text-fg' : 'text-fg-muted hover:bg-surface-2 hover:text-fg')}
    >
      <Icon className={cn('h-4 w-4 shrink-0 transition-colors', active && 'text-accent')} />
      <SideLabel collapsed={collapsed} className="flex-1 text-left">{item.label}</SideLabel>
      {badge ? (
        <StatusDot
          tone={badge === 'ok' ? 'success' : 'warning'}
          className={cn('absolute transition-all duration-300', collapsed ? 'left-[26px] top-1.5' : 'right-3 top-1/2 -translate-y-1/2')}
        />
      ) : null}
    </button>
  );
}

export function Sidebar() {
  const activeView = useAgentStore((s) => s.activeView);
  const themePreference = useAgentStore((s) => s.themePreference);
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
  const providers = `${providerCount} provider${providerCount === 1 ? '' : 's'}`;
  const footer = running
    ? { tone: 'accent' as const, pulse: true, text: `Running · ${done}/${mission!.tasks.length} tasks` }
    : !loaded
      ? { tone: 'neutral' as const, pulse: false, text: 'Checking providers…' }
      : connected
        ? { tone: 'success' as const, pulse: false, text: magpie ? `Magpie gateway · ${providers}` : `${providers} · ${modelCount} models` }
        : { tone: 'warning' as const, pulse: false, text: 'No provider connected' };
  const theme = THEME[themePreference] ?? THEME.system;
  const next = THEME[NEXT_THEME[themePreference] ?? 'light'];
  const ThemeIcon = theme.icon;

  return (
    <nav
      aria-label="Primary"
      data-collapsed={collapsed || undefined}
      className={cn(
        'flex shrink-0 flex-col overflow-hidden border-r border-line bg-surface/80 p-2 backdrop-blur',
        'transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none',
        collapsed ? 'w-14' : 'w-56'
      )}
    >
      <div className="mb-2 flex h-9 items-center gap-2.5 px-1.5">
        <img src="/logo.svg" alt="" className="h-7 w-7 shrink-0 drop-shadow-[0_2px_6px_rgba(91,155,255,0.35)]" />
        <SideLabel collapsed={collapsed} className="ahq-brand-text text-[14px] font-semibold tracking-tight">Agent HQ</SideLabel>
      </div>
      <div className="mb-3">
        <ProjectSwitcher collapsed={collapsed} />
      </div>
      <div className="space-y-2">
        {GROUPS.map((group) => (
          <div key={group.label} className="space-y-0.5">
            <div className="relative flex h-5 items-center px-3">
              <SideLabel collapsed={collapsed} className="text-[11px] font-medium text-fg-subtle">{group.label}</SideLabel>
              <span className={cn('absolute inset-x-2 top-1/2 h-px bg-line transition-opacity duration-300', collapsed ? 'opacity-100' : 'opacity-0')} />
            </div>
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
      <div className="mt-auto space-y-0.5 border-t border-line pt-2">
        <NavButton item={SETTINGS} collapsed={collapsed} active={activeView === 'settings'} />
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={`Theme: ${theme.label}. Switch to ${next.label} theme`}
          title={`Theme: ${theme.label}. Click for ${next.label}`}
          className={cn(ROW, 'text-fg-muted hover:bg-surface-2 hover:text-fg')}
        >
          <ThemeIcon className="h-4 w-4 shrink-0" />
          <SideLabel collapsed={collapsed} className="flex-1 text-left">{theme.label} theme</SideLabel>
        </button>
        <button
          type="button"
          onClick={() => setView(running ? 'tasks' : 'connections')}
          title={collapsed ? footer.text : undefined}
          aria-label={footer.text}
          className={cn(ROW, 'text-[11.5px] text-fg-muted hover:bg-surface-2 hover:text-fg')}
        >
          <span className="flex w-4 shrink-0 justify-center">
            <StatusDot tone={footer.tone} pulse={footer.pulse} />
          </span>
          <SideLabel collapsed={collapsed} className="flex-1 text-left">{footer.text}</SideLabel>
        </button>
        <button
          type="button"
          onClick={() => toggle('sidebarCollapsed')}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(ROW, 'text-fg-subtle hover:bg-surface-2 hover:text-fg')}
        >
          <ChevronsLeft className={cn('h-4 w-4 shrink-0 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]', collapsed && 'rotate-180')} />
          <SideLabel collapsed={collapsed} className="flex-1 text-left">Collapse</SideLabel>
        </button>
      </div>
    </nav>
  );
}
