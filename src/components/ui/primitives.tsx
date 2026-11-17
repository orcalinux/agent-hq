import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/utils/cn';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg hover:opacity-90',
  secondary: 'bg-surface-2 text-fg border border-line hover:bg-surface-3',
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
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-6 px-2 text-[12px]' : 'h-7 px-2.5 text-[12.5px]',
        VARIANT[variant],
        className
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : Icon ? <Icon className="h-3.5 w-3.5" /> : null}
      {children}
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
        'inline-flex shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40',
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
    <span title={title} className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-px text-[11px] font-medium', TONE_BADGE[tone], className)}>
      {children}
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
  'w-full rounded-md border border-line bg-surface px-2 text-[12.5px] text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none disabled:opacity-50';

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
      <span className="block text-[12px] font-medium text-fg-muted">{label}</span>
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

export function Tabs<T extends string>({ items, value, onChange, className, label }: { items: TabItem<T>[]; value: T; onChange: (id: T) => void; className?: string; label: string }) {
  return (
    <div role="tablist" aria-label={label} className={cn('flex items-center gap-0.5', className)}>
      {items.map((item) => (
        <button
          key={item.id}
          role="tab"
          type="button"
          aria-selected={value === item.id}
          onClick={() => onChange(item.id)}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] transition-colors',
            value === item.id ? 'bg-surface-3 text-fg' : 'text-fg-muted hover:bg-surface-2 hover:text-fg'
          )}
        >
          {item.label}
          {item.count ? <span className="rounded bg-surface-3 px-1 text-[10.5px] text-fg-muted">{item.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Section({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between">
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-fg-subtle">{title}</h3>
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
