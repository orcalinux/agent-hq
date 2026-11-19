import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/utils/cn';
import { IconButton } from './primitives';

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('[data-ahq-popover]')) return;
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
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = containerRef.current;
    const focusable = node?.querySelector<HTMLElement>('input, select, textarea, button:not([aria-label="Close"])');
    (focusable ?? node)?.focus();
    return () => previous?.focus?.();
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
  useEscape(open, onClose);
  useRestoreFocus(open, ref);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-overlay p-4 pt-[10vh] backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn('ahq-pop w-full overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-pop focus:outline-none', width)}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h2 className="text-[14px] font-semibold text-fg">{title}</h2>
            {description ? <p className="mt-0.5 text-[12px] text-fg-muted">{description}</p> : null}
          </div>
          <IconButton icon={X} label="Close" size="sm" onClick={onClose} />
        </div>
        <div className="max-h-[65vh] overflow-y-auto px-4 py-3">{children}</div>
        {footer ? <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-2.5">{footer}</div> : null}
      </div>
    </div>
  );
}

interface SidePanelProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  width?: number;
}

/** Right-hand details panel that sits inside the content area (not modal). */
export function SidePanel({ open, onClose, title, subtitle, children, width = 420 }: SidePanelProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target as HTMLElement)?.closest('[role="dialog"], [data-ahq-popover]')) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <aside
      aria-label={title}
      style={{ width }}
      className="flex h-full max-w-[85vw] shrink-0 flex-col border-l border-line bg-surface"
    >
      <div className="flex items-start justify-between gap-2 border-b border-line px-3 py-2.5">
        <div className="min-w-0">
          <h2 className="truncate text-[13.5px] font-semibold text-fg">{title}</h2>
          {subtitle ? <div className="mt-0.5 text-[12px] text-fg-muted">{subtitle}</div> : null}
        </div>
        <IconButton icon={X} label="Close details" size="sm" onClick={onClose} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
    </aside>
  );
}
