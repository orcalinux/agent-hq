import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { AppWindow, ArrowLeft, Check, ChevronRight, CircleHelp, FolderOpen, Menu, PanelsTopLeft, Pencil, RefreshCw } from 'lucide-react';
import { desktopApi } from '@/desktop/bridge';
import type { DesktopMenuItem } from '@/desktop/types';
import { useUpdateStore } from '@/desktop/useUpdate';
import { usePresence } from '@/components/ui/motion';
import { cn } from '@/utils/cn';

const icons = { File: FolderOpen, Edit: Pencil, View: PanelsTopLeft, Window: AppWindow, Help: CircleHelp } as const;
const noDrag = { WebkitAppRegion: 'no-drag' } as CSSProperties;

function shortcut(text: string, mac: boolean) {
  return text.replace(/CmdOrCtrl|CommandOrControl/g, mac ? '⌘' : 'Ctrl').replace(/Command|Cmd/g, '⌘').replace(/Control/g, 'Ctrl').replace(/Shift/g, mac ? '⇧' : 'Shift').replace(/Alt/g, mac ? '⌥' : 'Alt').replace(/\+/g, mac ? '' : '+');
}

export function ApplicationMenu() {
  const api = desktopApi();
  const [open, setOpen] = useState(false);
  const present = usePresence(open);
  const [items, setItems] = useState<DesktopMenuItem[]>([]);
  const [trail, setTrail] = useState<DesktopMenuItem[]>([]);
  const [failed, setFailed] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 36 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  const id = useId();
  const check = useUpdateStore((store) => store.check);
  const checking = useUpdateStore((store) => store.state?.status === 'checking');
  const current = trail.at(-1);
  const visible = current?.children ?? items;
  const close = useCallback((restore = true) => {
    setOpen(false);
    if (restore) trigger.current?.focus();
  }, []);
  const place = useCallback(() => {
    const rect = trigger.current?.getBoundingClientRect();
    if (rect) setPosition({ left: Math.max(8, Math.min(rect.left, innerWidth - 328)), top: rect.bottom + 6 });
  }, []);
  useEffect(() => {
    if (!open || !api) return;
    let live = true;
    setFailed(false);
    void api.getMenu().then((next) => { if (live) setItems(next); }).catch(() => { if (live) setFailed(true); });
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close(false);
    };
    const blur = () => close(false);
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('blur', blur);
    window.addEventListener('resize', place);
    return () => {
      live = false;
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('blur', blur);
      window.removeEventListener('resize', place);
    };
  }, [open, api, close, place]);
  useLayoutEffect(() => {
    if (open) panel.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')?.focus();
  }, [open, trail, items]);
  const run = (item: DesktopMenuItem) => {
    if (!item.enabled) return;
    if (item.children) setTrail((path) => [...path, item]);
    else {
      close();
      previous.current?.focus();
      api?.runMenuItem(item.id);
    }
  };
  const onKey = (event: KeyboardEvent) => {
    const buttons = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') {
      close();
    } else if (event.key === 'ArrowLeft' && trail.length) {
      event.preventDefault();
      setTrail((path) => path.slice(0, -1));
    } else if (event.key === 'ArrowRight') {
      const item = visible.find((entry) => entry.id === (document.activeElement as HTMLElement)?.dataset.menuId);
      if (item?.children) { event.preventDefault(); run(item); }
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && event.key !== ' ') {
      const ordered = [...buttons.slice(index + 1), ...buttons.slice(0, index + 1)];
      ordered.find((button) => button.textContent?.trim().toLowerCase().startsWith(event.key.toLowerCase()))?.focus();
    }
  };
  if (!api) return null;
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label="Application menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        style={noDrag}
        onPointerDown={() => { previous.current = document.activeElement as HTMLElement; }}
        onClick={() => {
          if (open) close();
          else { place(); setTrail([]); setOpen(true); }
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            place();
            setTrail([]);
            setOpen(true);
          }
        }}
        className={cn('ahq-icon-button flex h-7 w-8 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg focus-visible:outline focus-visible:outline-accent', open && 'bg-surface-3 text-fg')}
      ><Menu className="h-4 w-4" /></button>
      {present ? createPortal(
        <div
          ref={panel}
          id={id}
          data-ahq-popover=""
          data-open={open}
          aria-hidden={!open || undefined}
          inert={!open}
          onKeyDown={onKey}
          style={{ ...noDrag, position: 'fixed', left: position.left, top: position.top, maxHeight: `calc(100dvh - ${position.top + 8}px)` }}
          className="ahq-menu-surface z-[80] flex w-80 max-w-[calc(100vw-16px)] origin-top-left flex-col overflow-hidden rounded-xl border border-line-strong bg-surface text-fg shadow-pop"
          data-testid="application-menu"
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5">
            {current ? <button type="button" aria-label="Back to parent menu" onClick={() => setTrail((path) => path.slice(0, -1))} className="ahq-icon-button -ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-3"><ArrowLeft className="h-3.5 w-3.5" /></button> : <AppWindow className="h-4 w-4 text-accent" />}
            <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{current?.label ?? 'Agent HQ'}</span>
            <span className="shrink-0 font-mono text-[10px] text-fg-subtle">v{api.version}</span>
          </div>
          <div role="menu" aria-label={current?.label ?? 'Application'} className="min-h-0 overflow-y-auto p-1.5">
            {failed ? <p role="status" className="px-2 py-3 text-[12px] text-fg-muted">Couldn’t load the menu. Close and reopen to retry.</p> : !items.length ? <p role="status" className="px-2 py-3 text-[12px] text-fg-subtle">Loading menu…</p> : visible.map((item) => {
              if (item.separator) return <div role="separator" key={item.id} className="mx-2 my-1.5 h-px bg-line" />;
              const Icon = icons[item.label as keyof typeof icons];
              return (
                <button
                  key={item.id}
                  data-menu-id={item.id}
                  role={item.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
                  aria-checked={item.checked}
                  aria-haspopup={item.children ? 'menu' : undefined}
                  type="button"
                  tabIndex={-1}
                  disabled={!item.enabled}
                  onClick={() => run(item)}
                  onPointerMove={(event) => event.currentTarget.focus({ preventScroll: true })}
                  className="ahq-menu-item flex min-h-8 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[12.5px] text-fg-muted outline-none hover:bg-surface-3 hover:text-fg focus:bg-accent-soft focus:text-fg disabled:opacity-40"
                >
                  {Icon ? <Icon className="h-4 w-4 shrink-0 text-fg-subtle" /> : item.checked !== undefined ? <span className="w-4 shrink-0">{item.checked ? <Check className="h-3.5 w-3.5 text-accent" /> : null}</span> : null}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.shortcut ? <kbd className="shrink-0 font-sans text-[10.5px] text-fg-subtle">{shortcut(item.shortcut, api.platform === 'darwin')}</kbd> : null}
                  {item.children ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-fg-subtle" /> : null}
                </button>
              );
            })}
          </div>
          <div role="menu" aria-label="Updates" className="shrink-0 border-t border-line p-1.5">
            <button type="button" role="menuitem" tabIndex={-1} onClick={() => { close(); check(); }} className="ahq-menu-item flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[12px] text-fg-muted outline-none hover:bg-surface-3 focus:bg-accent-soft focus:text-fg">
              <RefreshCw className={cn('h-3.5 w-3.5 shrink-0 text-accent', checking && 'animate-spin motion-reduce:animate-none')} />
              <span className="min-w-0 flex-1 truncate">{checking ? 'Checking for updates…' : 'Check for updates'}</span>
              <span aria-hidden="true" className="text-[10px] text-fg-subtle">GitHub Releases</span>
            </button>
          </div>
        </div>, document.body
      ) : null}
    </>
  );
}
