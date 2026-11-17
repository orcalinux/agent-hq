import { useCallback, useRef } from 'react';
import { cn } from '@/utils/cn';

interface SplitterProps {
  orientation: 'vertical' | 'horizontal';
  size: number;
  onResize: (size: number) => void;
  min: number;
  max: number;
  /** Which side the controlled panel sits on. 'end' means growing when dragging toward the start. */
  side: 'start' | 'end';
  label: string;
}

/**
 * Accessible resize handle. `orientation="vertical"` is a vertical bar that resizes widths.
 * Supports pointer drag, arrow keys (Shift = larger steps), Home/End and double-click to reset via min.
 */
export function Splitter({ orientation, size, onResize, min, max, side, label }: SplitterProps) {
  const dragging = useRef(false);
  const horizontalAxis = orientation === 'vertical';
  const clamp = useCallback((value: number) => Math.min(max, Math.max(min, Math.round(value))), [min, max]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragging.current = true;
    const start = horizontalAxis ? e.clientX : e.clientY;
    const startSize = size;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const delta = (horizontalAxis ? ev.clientX : ev.clientY) - start;
      onResize(clamp(side === 'start' ? startSize + delta : startSize - delta));
    };
    const up = () => {
      dragging.current = false;
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 48 : 12;
    const grow = horizontalAxis ? (side === 'start' ? 'ArrowRight' : 'ArrowLeft') : side === 'start' ? 'ArrowDown' : 'ArrowUp';
    const shrink = horizontalAxis ? (side === 'start' ? 'ArrowLeft' : 'ArrowRight') : side === 'start' ? 'ArrowUp' : 'ArrowDown';
    if (e.key === grow) onResize(clamp(size + step));
    else if (e.key === shrink) onResize(clamp(size - step));
    else if (e.key === 'Home') onResize(min);
    else if (e.key === 'End') onResize(max);
    else return;
    e.preventDefault();
  };

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      aria-valuenow={size}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={cn(
        'relative z-10 shrink-0 bg-line transition-colors hover:bg-accent focus-visible:bg-accent',
        horizontalAxis ? 'w-px cursor-col-resize after:absolute after:inset-y-0 after:-left-1 after:-right-1' : 'h-px cursor-row-resize after:absolute after:inset-x-0 after:-top-1 after:-bottom-1'
      )}
    />
  );
}
