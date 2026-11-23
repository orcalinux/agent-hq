import { useEffect, useRef, type KeyboardEvent } from 'react';
import { Minus, Plus } from 'lucide-react';
import { cn } from '@/utils/cn';

export function stepValue(draft: string, direction: 1 | -1, step: number, min = 0): string {
  const parsed = Number(draft);
  const base = draft.trim() === '' || !Number.isFinite(parsed) ? 0 : parsed;
  const decimals = (String(step).split('.')[1] ?? '').length;
  const next = Math.max(min, Number((base + direction * step).toFixed(decimals)));
  return String(next);
}

export function sanitizeNumber(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, '');
  const [whole, ...rest] = cleaned.split('.');
  return rest.length ? `${whole}.${rest.join('')}` : whole;
}

interface NumberInputProps {
  value: string;
  onChange: (value: string) => void;
  onCommit: (value: string) => void;
  step: number;
  min?: number;
  unit?: string;
  placeholder?: string;
  'aria-label'?: string;
  className?: string;
}

const STEP_BUTTON =
  'ahq-icon-button flex h-full w-7 shrink-0 items-center justify-center text-fg-muted hover:bg-surface-3 hover:text-fg focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40';

export function NumberInput({ value, onChange, onCommit, step, min = 0, unit, placeholder, className, ...aria }: NumberInputProps) {
  const latest = useRef(value);
  const timers = useRef<{ delay?: number; repeat?: number }>({});
  latest.current = value;
  const stop = () => {
    window.clearTimeout(timers.current.delay);
    window.clearInterval(timers.current.repeat);
  };
  useEffect(() => stop, []);
  const apply = (direction: 1 | -1) => {
    const next = stepValue(latest.current, direction, step, min);
    latest.current = next;
    onChange(next);
    onCommit(next);
  };
  const hold = (direction: 1 | -1) => {
    stop();
    apply(direction);
    timers.current.delay = window.setTimeout(() => {
      timers.current.repeat = window.setInterval(() => apply(direction), 70);
    }, 380);
  };
  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') onCommit(value);
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      apply(event.key === 'ArrowUp' ? 1 : -1);
    }
  };
  const numeric = value.trim() === '' ? undefined : Number(value);
  const buttonProps = (direction: 1 | -1) => ({
    type: 'button' as const,
    tabIndex: -1,
    onPointerDown: (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      hold(direction);
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        apply(direction);
      }
    },
  });
  return (
    <div className={cn('ahq-field flex h-8 w-full items-stretch overflow-hidden rounded-lg border border-line bg-surface focus-within:border-accent', className)}>
      <input
        role="spinbutton"
        inputMode="decimal"
        autoComplete="off"
        aria-valuemin={min}
        aria-valuenow={Number.isFinite(numeric) ? numeric : undefined}
        aria-label={aria['aria-label']}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(sanitizeNumber(event.target.value))}
        onBlur={() => onCommit(value)}
        onKeyDown={keys}
        className="min-w-0 flex-1 bg-transparent px-2.5 font-mono text-[12.5px] tabular-nums text-fg placeholder:font-sans placeholder:text-fg-subtle focus:outline-none"
      />
      {unit ? <span aria-hidden className="flex items-center pr-2 text-[11px] text-fg-subtle">{unit}</span> : null}
      <div className="flex border-l border-line">
        <button aria-label="Decrease" disabled={numeric !== undefined && numeric <= min} className={STEP_BUTTON} {...buttonProps(-1)}>
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button aria-label="Increase" className={cn(STEP_BUTTON, 'border-l border-line')} {...buttonProps(1)}>
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
