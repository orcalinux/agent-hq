import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';

/**
 * Text that fades and slides out while the sidebar narrows. It stays mounted, so nothing jumps:
 * the sidebar animates its width and icons keep their position.
 */
export function SideLabel({ collapsed, children, className }: { collapsed: boolean; children: ReactNode; className?: string }) {
  return (
    <span
      aria-hidden={collapsed || undefined}
      className={cn(
        'ahq-side-label min-w-0 truncate whitespace-nowrap',
        collapsed ? 'pointer-events-none -translate-x-1.5 opacity-0' : 'translate-x-0 opacity-100',
        className
      )}
    >
      {children}
    </span>
  );
}
