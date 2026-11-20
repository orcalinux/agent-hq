import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/utils/cn';

export function IconTile({ icon: Icon, tint, size = 32, className }: { icon: LucideIcon; tint: string; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('flex shrink-0 items-center justify-center rounded-lg', className)}
      style={{
        width: size,
        height: size,
        color: tint,
        background: `color-mix(in srgb, ${tint} 15%, var(--surface))`,
        boxShadow: `0 0 0 1px color-mix(in srgb, ${tint} 30%, transparent)`,
      }}
    >
      <Icon style={{ width: Math.round(size / 2), height: Math.round(size / 2) }} />
    </span>
  );
}

export function PanelCard({
  icon,
  tint,
  title,
  hint,
  action,
  children,
  className,
  bodyClassName,
}: {
  icon: LucideIcon;
  tint: string;
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section aria-label={title} className={cn('overflow-hidden rounded-xl border border-line bg-surface shadow-card', className)}>
      <header className="flex items-center gap-2.5 border-b border-line px-3.5 py-2.5">
        <IconTile icon={icon} tint={tint} size={26} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13px] font-semibold tracking-tight">{title}</h3>
          {hint ? <p className="truncate text-[11.5px] text-fg-subtle">{hint}</p> : null}
        </div>
        {action}
      </header>
      <div className={cn('space-y-3 px-3.5 py-3', bodyClassName)}>{children}</div>
    </section>
  );
}

export function StatTile({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'danger' | 'success' }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface px-3 py-2.5 shadow-card">
      <p className="truncate text-[11px] font-medium text-fg-subtle">{label}</p>
      <p className={cn('mt-0.5 truncate text-[16px] font-semibold tabular-nums tracking-tight', tone === 'danger' && 'text-danger', tone === 'success' && 'text-success')}>{value}</p>
      {hint ? <p className="truncate text-[11px] text-fg-subtle">{hint}</p> : null}
    </div>
  );
}

