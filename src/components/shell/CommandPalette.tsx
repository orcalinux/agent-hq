import { useEffect, useMemo, useRef, useState } from 'react';
import { useAgentStore } from '@/store/useAgentStore';
import { useLayoutStore } from '@/store/useLayoutStore';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { useConnectionsStore } from '@/store/useConnectionsStore';
import { stopChat } from '@/engine/liveOrchestrator';
import { api } from '@/api/client';
import { cn } from '@/utils/cn';
import { Kbd } from '@/components/ui/primitives';
import { openIntegratedTerminal } from '@/utils/terminalActions';
import type { ViewMode } from '@/types';

interface Command {
  id: string;
  label: string;
  group: string;
  hint?: string;
  run: () => void;
}

function buildCommands(): Command[] {
  const agent = useAgentStore.getState;
  const layout = useLayoutStore.getState;
  const ws = useWorkspaceStore.getState;
  const goto = (view: ViewMode) => () => agent().setActiveView(view);
  const inWorkspace = (fn: () => void) => () => {
    agent().setActiveView('workspace');
    fn();
  };
  return [
    { id: 'v-workspace', group: 'Go to', label: 'Workspace', hint: 'Alt+1', run: goto('workspace') },
    { id: 'v-agents', group: 'Go to', label: 'Agents', hint: 'Alt+2', run: goto('agents') },
    { id: 'v-tasks', group: 'Go to', label: 'Tasks', hint: 'Alt+3', run: goto('tasks') },
    { id: 'v-reports', group: 'Go to', label: 'Reports', hint: 'Alt+4', run: goto('reports') },
    { id: 'v-conn', group: 'Go to', label: 'Connections & Models', hint: 'Alt+5', run: goto('connections') },
    { id: 'v-settings', group: 'Go to', label: 'Settings', hint: 'Ctrl+,', run: goto('settings') },
    { id: 'theme', group: 'View', label: 'Switch theme (System, Light, Dark)', run: () => agent().toggleThemeMode() },
    { id: 'terminal-open', group: 'View', label: 'Open integrated terminal', hint: 'Ctrl+`', run: () => openIntegratedTerminal() },
    { id: 'terminal-external', group: 'View', label: 'Open project in external terminal app', run: () => void api.openTerminal().catch(() => undefined) },
    { id: 'sidebar', group: 'View', label: 'Toggle sidebar', run: () => layout().toggle('sidebarCollapsed') },
    { id: 'explorer', group: 'View', label: 'Toggle explorer', hint: 'Ctrl+B', run: inWorkspace(() => layout().toggle('explorerVisible')) },
    { id: 'bottom', group: 'View', label: 'Toggle bottom panel', hint: 'Ctrl+J', run: inWorkspace(() => layout().toggle('bottomVisible')) },
    { id: 'chat', group: 'View', label: 'Toggle orchestrator chat', hint: 'Ctrl+L', run: inWorkspace(() => layout().toggle('chatVisible')) },
    { id: 'layout-code', group: 'View', label: 'Layout: code focused', run: inWorkspace(() => layout().set({ workspaceLayout: 'code', chatVisible: true })) },
    { id: 'layout-chat', group: 'View', label: 'Layout: chat focused', run: inWorkspace(() => layout().set({ workspaceLayout: 'chat', chatVisible: true })) },
    { id: 'activity', group: 'View', label: 'Toggle activity monitor', run: () => layout().toggle('activityOpen') },
    { id: 'layout-reset', group: 'View', label: 'Reset panel layout', run: () => layout().reset() },
    { id: 'mode-ask', group: 'Orchestrator', label: 'Mode: Ask', run: inWorkspace(() => agent().setOrchestratorMode('ask')) },
    { id: 'mode-plan', group: 'Orchestrator', label: 'Mode: Plan', run: inWorkspace(() => agent().setOrchestratorMode('plan')) },
    { id: 'mode-build', group: 'Orchestrator', label: 'Mode: Build', run: inWorkspace(() => agent().setOrchestratorMode('build')) },
    { id: 'chat-stop', group: 'Orchestrator', label: 'Stop current reply', run: () => stopChat() },
    { id: 'chat-clear', group: 'Orchestrator', label: 'Clear conversation', run: () => agent().clearChat() },
    { id: 'typecheck', group: 'Workspace', label: 'Run type check (Problems)', run: inWorkspace(() => { layout().set({ bottomVisible: true, bottomTab: 'problems' }); void ws().runTypeCheck(); }) },
    { id: 'refresh', group: 'Workspace', label: 'Refresh files and git status', run: () => { void ws().refreshTree(); void ws().loadGit(); } },
    { id: 'detect', group: 'Connections', label: 'Re-detect CLIs and Ollama', run: () => { goto('connections')(); void useConnectionsStore.getState().detect(); } },
  ];
}

export function CommandPalette() {
  const open = useAgentStore((s) => s.isCommandPaletteOpen);
  const setOpen = useAgentStore((s) => s.setCommandPaletteOpen);
  const tree = useWorkspaceStore((s) => s.tree);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const items = useMemo<Command[]>(() => {
    if (!open) return [];
    const q = query.trim().toLowerCase();
    const commands = buildCommands().filter((c) => !q || `${c.group} ${c.label}`.toLowerCase().includes(q));
    const files: Command[] = q
      ? tree
          .filter((f) => f.type === 'file' && f.path.toLowerCase().includes(q))
          .slice(0, 12)
          .map((f) => ({
            id: `file-${f.path}`,
            group: 'Files',
            label: f.path,
            run: () => {
              useAgentStore.getState().setActiveView('workspace');
              void useWorkspaceStore.getState().openFile(f.path);
            },
          }))
      : [];
    return [...commands, ...files];
  }, [open, query, tree]);

  useEffect(() => { setIndex(0); }, [query]);
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  if (!open) return null;

  const run = (cmd: Command | undefined) => {
    if (!cmd) return;
    setOpen(false);
    cmd.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(items[index]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  let lastGroup = '';
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-overlay pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div role="dialog" aria-modal="true" aria-label="Command palette" className="mx-4 w-full max-w-xl overflow-hidden rounded-lg border border-line-strong bg-surface shadow-xl" onKeyDown={onKeyDown}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type a command or file name…"
          aria-label="Command"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          className="h-11 w-full border-b border-line bg-transparent px-4 text-[14px] placeholder:text-fg-subtle focus:outline-none"
        />
        <div id="palette-list" role="listbox" ref={listRef} className="max-h-80 overflow-y-auto py-1">
          {items.length === 0 ? <p className="px-4 py-6 text-center text-[12.5px] text-fg-subtle">No matching commands</p> : null}
          {items.map((cmd, i) => {
            const header = cmd.group !== lastGroup;
            lastGroup = cmd.group;
            return (
              <div key={cmd.id}>
                {header ? <div className="px-4 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">{cmd.group}</div> : null}
                <div
                  role="option"
                  aria-selected={i === index}
                  data-active={i === index}
                  onMouseMove={() => setIndex(i)}
                  onClick={() => run(cmd)}
                  className={cn('flex h-8 cursor-pointer items-center justify-between gap-3 px-4 text-[13px]', i === index ? 'bg-accent-soft text-fg' : 'text-fg-muted')}
                >
                  <span className="min-w-0 truncate">{cmd.label}</span>
                  {cmd.hint ? <span className="shrink-0"><Kbd>{cmd.hint}</Kbd></span> : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
