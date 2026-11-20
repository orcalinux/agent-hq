import { useCallback, useEffect, useRef, useState } from 'react';
import { Eraser, Plus, RotateCcw, SquareTerminal, X } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import { getRuntime, useTerminalStore } from '@/store/useTerminalStore';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { Button, IconButton, Spinner } from '@/components/ui/primitives';
import { cn } from '@/utils/cn';
import { FOCUS_TERMINAL_EVENT } from '@/utils/terminalActions';

let autoStarted = false;

function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function TerminalPane() {
  const sessions = useTerminalStore((s) => s.sessions);
  const activeId = useTerminalStore((s) => s.activeId);
  const error = useTerminalStore((s) => s.error);
  const creating = useTerminalStore((s) => s.creating);
  const { sync, create, close, restart, select } = useTerminalStore.getState();
  useTerminalStore((s) => s.version);
  const root = useWorkspaceStore((s) => s.root);
  const stage = useRef<HTMLDivElement>(null);
  const pane = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const active = sessions.find((s) => s.id === activeId) ?? null;

  useEffect(() => {
    let cancelled = false;
    void sync().then(() => {
      if (cancelled) return;
      setReady(true);
      if (!autoStarted && useTerminalStore.getState().sessions.length === 0) {
        autoStarted = true;
        void create();
      }
      autoStarted = true;
    });
    return () => {
      cancelled = true;
    };
  }, [sync, create]);

  const fitActive = useCallback(() => {
    const runtime = activeId ? getRuntime(activeId) : undefined;
    const element = stage.current;
    if (!runtime || !element || element.offsetWidth === 0 || element.offsetHeight === 0) return;
    try {
      runtime.fit.fit();
      runtime.term.refresh(0, runtime.term.rows - 1);
    } catch {
      /* terminal not measurable yet */
    }
  }, [activeId]);

  useEffect(() => {
    const element = stage.current;
    const runtime = activeId ? getRuntime(activeId) : undefined;
    if (!element || !runtime) return;
    element.replaceChildren(runtime.host);
    if (!runtime.term.element) runtime.term.open(runtime.host);
    requestAnimationFrame(() => {
      fitActive();
      runtime.term.refresh(0, runtime.term.rows - 1);
      const focused = document.activeElement;
      const free = !focused || focused === document.body || focused === document.documentElement;
      if (free || pane.current?.contains(focused)) runtime.term.focus();
    });
    const observer = new ResizeObserver(() => fitActive());
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (runtime.host.parentElement === element) runtime.host.remove();
    };
  }, [activeId, fitActive, sessions.length]);

  useEffect(() => {
    const focus = () => {
      const runtime = activeId ? getRuntime(activeId) : undefined;
      requestAnimationFrame(() => {
        fitActive();
        runtime?.term.focus();
      });
    };
    window.addEventListener(FOCUS_TERMINAL_EVENT, focus);
    return () => window.removeEventListener(FOCUS_TERMINAL_EVENT, focus);
  }, [activeId, fitActive]);

  const clear = () => {
    const runtime = activeId ? getRuntime(activeId) : undefined;
    runtime?.term.clear();
    runtime?.term.focus();
  };

  return (
    <div ref={pane} className="flex h-full min-h-0 flex-col" data-testid="integrated-terminal">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line bg-surface-2/60 pl-1.5 pr-1">
        <div role="tablist" aria-label="Terminals" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {sessions.map((session, index) => {
            const selected = session.id === activeId;
            return (
              <div
                key={session.id}
                className={cn(
                  'group relative flex h-6 shrink-0 items-center gap-1.5 rounded-md pl-2 pr-1 text-[12px] transition-colors duration-150',
                  selected ? 'bg-canvas text-fg shadow-[inset_0_0_0_1px_var(--line)]' : 'text-fg-muted hover:bg-surface-3/70 hover:text-fg'
                )}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  title={`${session.shell} in ${session.cwd}`}
                  onClick={() => {
                    select(session.id);
                  }}
                  className="flex items-center gap-1.5"
                >
                  <span className={cn('h-1.5 w-1.5 rounded-full', session.exited ? 'bg-fg-subtle' : 'bg-success')} aria-hidden />
                  <span className="max-w-[150px] truncate">
                    {session.shell}
                    <span className="text-fg-subtle"> · {folderName(session.cwd)}</span>
                    {sessions.length > 1 ? <span className="sr-only"> {index + 1}</span> : null}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Close terminal ${session.shell} in ${folderName(session.cwd)}`}
                  onClick={() => void close(session.id)}
                  className="grid h-4 w-4 place-items-center rounded text-fg-subtle opacity-70 hover:bg-surface-3 hover:text-fg group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
          <IconButton icon={creating ? RotateCcw : Plus} label="New terminal" size="sm" disabled={creating} onClick={() => void create()} />
        </div>
        {active ? (
          <div className="flex items-center gap-0.5">
            <IconButton icon={Eraser} label="Clear terminal" size="sm" onClick={clear} />
          </div>
        ) : null}
      </div>
      <div className="relative min-h-0 flex-1 bg-canvas">
        <div ref={stage} className={cn('absolute inset-0 px-3 pb-1 pt-2', !active && 'hidden')} />
        {active?.exited ? (
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 border-t border-line bg-surface/95 px-3 py-1.5 text-[12px] text-fg-muted backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-fg-subtle" />
            <span>
              {active.exitCode === null ? 'Terminal disconnected.' : `Process exited with code ${active.exitCode}.`}
            </span>
            <Button size="sm" className="ml-auto" icon={RotateCcw} onClick={() => void restart(active.id)}>
              Restart
            </Button>
          </div>
        ) : null}
        {!active ? (
          <div className="absolute inset-0 grid place-items-center p-4 text-center">
            {creating || (!ready && !error) ? (
              <Spinner />
            ) : (
              <div className="max-w-sm space-y-2">
                <SquareTerminal className="mx-auto h-6 w-6 text-fg-subtle" />
                <p className="text-[13px] font-medium">{error ? 'The terminal could not start' : 'No terminal is open'}</p>
                <p className="text-[12px] text-fg-muted">
                  {error ?? (root ? `Start your shell in ${folderName(root)}.` : 'Open a project first, then start a shell in it.')}
                </p>
                <Button size="sm" variant="primary" icon={Plus} onClick={() => void create()}>
                  New terminal
                </Button>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
