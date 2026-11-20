import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/utils/cn';
import { IconButton } from './primitives';
import { usePresence } from './motion';

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('[data-ahq-popover]')) return;
      const target = e.target as HTMLInputElement | null;
      if (e.key === 'Escape' && target?.hasAttribute?.('data-escape-clears') && target.value) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open, onClose]);
}

function useRestoreFocus(open: boolean, containerRef: React.RefObject<HTMLElement | null>) {
  const previous = document.activeElement as HTMLElement | null;
  useLayoutEffect(() => {
    if (!open) return;
    const node = containerRef.current;
    const root = document.getElementById('root');
    const wasInert = root?.inert ?? false;
    if (root) root.inert = true;
    const wanted = node?.querySelector<HTMLElement>('[data-autofocus]');
    const alreadyInside = node && document.activeElement && document.activeElement !== node && node.contains(document.activeElement);
    if (wanted) wanted.focus();
    else if (!alreadyInside) {
      const focusable = node?.querySelector<HTMLElement>('input, select, textarea, button:not([aria-label="Close"])');
      (focusable ?? node)?.focus();
    }
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || (event.target as HTMLElement)?.closest('[data-ahq-popover]')) return;
      const elements = Array.from(node?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') ?? [])
        .filter((element) => element.getClientRects().length > 0);
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first || !last) {
        event.preventDefault();
        node?.focus();
      } else if (event.shiftKey && (document.activeElement === first || !node?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !node?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', trapFocus);
    return () => {
      window.removeEventListener('keydown', trapFocus);
      if (root) root.inert = wasInert;
      previous?.focus?.();
    };
  }, [open, containerRef]);
}

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}

export function Dialog({ open, onClose, title, description, children, footer, width = 'max-w-lg' }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const present = usePresence(open);
  const lastContent = useRef({ title, description, children, footer });
  useLayoutEffect(() => {
    if (open) lastContent.current = { title, description, children, footer };
  }, [open, title, description, children, footer]);
  const content = open ? { title, description, children, footer } : lastContent.current;
  useEscape(open, onClose);
  useRestoreFocus(present, ref);
  if (!present) return null;
  return createPortal(
    <div data-open={open} className="ahq-dialog-overlay fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[10vh]" onMouseDown={(e) => open && e.target === e.currentTarget && onClose()}>
      <div aria-hidden="true" className="ahq-dialog-scrim pointer-events-none fixed inset-0 bg-overlay backdrop-blur-[2px]" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={content.title}
        tabIndex={-1}
        className={cn('ahq-dialog-surface relative w-full overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-pop focus:outline-none', width)}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-[14px] font-semibold text-fg">{content.title}</h2>
            {content.description ? <p className="mt-0.5 text-[12px] text-fg-muted">{content.description}</p> : null}
          </div>
          <IconButton icon={X} label="Close" size="sm" onClick={onClose} />
        </div>
        <div className="max-h-[65vh] overflow-y-auto px-4 py-3">{content.children}</div>
        {content.footer ? <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-2.5">{content.footer}</div> : null}
      </div>
    </div>,
    document.body
  );
}

interface SidePanelProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  leading?: ReactNode;
  meta?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  width?: number;
  tint?: string;
}

/** Right-hand details panel that sits inside the content area (not modal). */
export function SidePanel({ open, onClose, title, subtitle, leading, meta, footer, children, width = 420, tint }: SidePanelProps) {
  const present = usePresence(open);
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target as HTMLElement)?.closest('[role="dialog"], [data-ahq-popover]')) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);
  if (!present) return null;
  return (
    <aside
      aria-label={title}
      aria-hidden={!open || undefined}
      inert={!open}
      data-open={open}
      style={{ width }}
      className="ahq-detail-surface flex h-full min-w-0 max-w-[50%] shrink-0 flex-col border-l border-line bg-canvas"
    >
      <div
        className="relative border-b border-line bg-surface px-4 pb-3 pt-3.5"
        style={tint ? { backgroundImage: `radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, ${tint} 12%, transparent), transparent 60%)` } : undefined}
      >
        <div className="flex items-start gap-3">
          {leading}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] font-semibold tracking-tight text-fg">{title}</h2>
            {subtitle ? <div className="mt-0.5 truncate text-[12px] text-fg-muted">{subtitle}</div> : null}
          </div>
          <IconButton icon={X} label="Close details" size="sm" onClick={onClose} />
        </div>
        {meta ? <div className="mt-2.5 flex flex-wrap items-center gap-1.5">{meta}</div> : null}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">{children}</div>
      {footer}
    </aside>
  );
}
