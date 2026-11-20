import { forwardRef, useEffect, type ButtonHTMLAttributes, type CSSProperties, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/utils/cn';
import { useSelectionIndicator } from './motion';

type TruncateTag = 'span' | 'div' | 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'strong' | 'code';

/**
 * Single-line text that ends in an ellipsis when its container is too narrow, and shows the full text
 * in the shared overflow tooltip only while it is cut off. `lines` clamps to that many lines instead.
 * Truncation is measured from the rendered width, never a character count.
 */
export function Truncate({ as: Tag = 'span', lines, className, style, children, fullText }: { as?: TruncateTag; lines?: number; className?: string; style?: CSSProperties; children: ReactNode; fullText?: string }) {
  const clamp: CSSProperties | undefined = lines && lines > 1 ? { display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' } : undefined;
  return (
    <Tag data-truncate="" data-full-text={fullText} className={cn('min-w-0 max-w-full', clamp ? 'break-words' : 'block truncate', className)} style={{ ...clamp, ...style }}>
      {children}
    </Tag>
  );
}

/** Plain-text children become a truncating label; anything else is left as it is. */
function label(children: ReactNode): ReactNode {
  return typeof children === 'string' || typeof children === 'number' ? <span className="min-w-0 truncate">{children}</span> : children;
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'ahq-btn-primary text-accent-fg',
  secondary: 'bg-surface-2 text-fg border border-line shadow-card hover:border-line-strong hover:bg-surface-3',
  ghost: 'text-fg-muted hover:bg-surface-2 hover:text-fg',
  danger: 'bg-danger-soft text-danger border border-danger/30 hover:bg-danger/20',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon: Icon, loading, className, children, disabled, type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'ahq-button inline-flex max-w-full shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-6 px-2 text-[12px]' : 'h-7 px-2.5 text-[12.5px]',
        VARIANT[variant],
        className
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : Icon ? <Icon className="h-3.5 w-3.5 shrink-0" /> : null}
      {label(children)}
    </button>
  );
});

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  size?: 'sm' | 'md';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, active, size = 'md', className, type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        'ahq-icon-button inline-flex shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-3 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40',
        size === 'sm' ? 'h-6 w-6' : 'h-7 w-7',
        active && 'bg-surface-3 text-fg',
        className
      )}
      {...rest}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
});

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const TONE_BADGE: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-fg-muted',
  accent: 'bg-accent-soft text-accent',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
};

export function Badge({ tone = 'neutral', children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn('inline-flex min-w-0 max-w-full items-center gap-1 whitespace-nowrap rounded-full px-2 py-px text-[11px] font-medium', TONE_BADGE[tone], className)}>
      {label(children)}
    </span>
  );
}

const TONE_DOT: Record<Tone, string> = {
  neutral: 'bg-fg-subtle',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

export function StatusDot({ tone = 'neutral', pulse, className }: { tone?: Tone; pulse?: boolean; className?: string }) {
  return <span aria-hidden className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full', TONE_DOT[tone], pulse && 'animate-pulse', className)} />;
}

const FIELD =
  'ahq-field w-full rounded-md border border-line bg-surface px-2 text-[12.5px] text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none disabled:opacity-50';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(FIELD, 'h-7', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(FIELD, 'min-h-[84px] resize-y py-1.5', className)} {...rest} />;
});

export { Select, type SelectProps, type SelectChangeEvent } from './Select';

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block space-y-1', className)}>
      <span className="block truncate text-[12px] font-medium text-fg-muted">{label}</span>
      {children}
      {hint ? <span className="block text-[11.5px] text-fg-subtle">{hint}</span> : null}
    </label>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-surface-2 px-1 font-mono text-[10.5px] text-fg-subtle">{children}</kbd>
  );
}

export function EmptyState({ icon: Icon, title, children, action }: { icon?: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex h-full min-h-32 flex-col items-center justify-center gap-2 p-6 text-center">
      {Icon ? <Icon className="h-6 w-6 text-fg-subtle" /> : null}
      <div className="text-[13px] font-medium text-fg">{title}</div>
      {children ? <div className="max-w-sm text-[12px] text-fg-muted">{children}</div> : null}
      {action}
    </div>
  );
}

export interface TabItem<T extends string> {
  id: T;
  label: string;
  count?: number;
}

/**
 * Tab labels shrink and ellipsise together as the bar narrows, down to a readable minimum; past that
 * the bar scrolls sideways (without a scrollbar) and keeps the selected tab in view.
 */
export function Tabs<T extends string>({ items, value, onChange, className, label }: { items: TabItem<T>[]; value: T; onChange: (id: T) => void; className?: string; label: string }) {
  const { containerRef: listRef, indicatorRef } = useSelectionIndicator(value, '[aria-selected="true"]');
  useEffect(() => {
    const list = listRef.current;
    const tab = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !tab || list.scrollWidth <= list.clientWidth) return;
    const left = tab.offsetLeft - list.offsetLeft;
    if (left < list.scrollLeft || left + tab.offsetWidth > list.scrollLeft + list.clientWidth) list.scrollTo({ left: Math.max(0, left - 8) });
  }, [value]);
  return (
    <div ref={listRef} role="tablist" aria-label={label} className={cn('relative isolate flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-lg bg-surface-2/60 p-0.5 [scrollbar-width:none]', className)}>
      <span ref={indicatorRef} aria-hidden="true" data-selection-indicator="" className="ahq-selection rounded-md bg-surface-3 shadow-card" />
      {items.map((item) => (
        <button
          key={item.id}
          role="tab"
          type="button"
          aria-selected={value === item.id}
          onClick={() => onChange(item.id)}
          className={cn(
            'relative inline-flex h-6 shrink items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[12.5px] transition-colors',
            value === item.id ? 'text-fg' : 'text-fg-muted hover:text-fg'
          )}
        >
          <span className="ahq-min-label truncate">{item.label}</span>
          {item.count ? <span className="shrink-0 rounded-full bg-accent-soft px-1.5 text-[10.5px] font-medium text-accent">{item.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** View heading in the breadcrumb style: a muted group name, then the view. */
export function PageTitle({ group, title, subtitle }: { group: string; title: string; subtitle?: ReactNode }) {
  return (
    <div className="min-w-0">
      <h1 className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[14px] font-semibold tracking-tight">
        <span className="min-w-0 shrink-[4] truncate font-normal text-fg-subtle">{group}</span>
        <span className="shrink-0 font-normal text-fg-subtle/60">/</span>
        <span className="min-w-0 truncate">{title}</span>
      </h1>
      {subtitle ? <div className="truncate text-[12px] text-fg-muted">{subtitle}</div> : null}
    </div>
  );
}

export function Section({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-2', className)}>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <h3 className="min-w-0 truncate text-[12px] font-semibold uppercase tracking-wide text-fg-subtle">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-4 w-4 animate-spin text-fg-subtle', className)} />;
}

export function ProgressBar({ value, tone = 'accent' }: { value: number; tone?: Tone }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-full rounded-full', TONE_DOT[tone])} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}
