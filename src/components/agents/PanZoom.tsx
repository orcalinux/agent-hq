import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { LayoutGrid, Maximize, Minus, Plus } from 'lucide-react';
import { IconButton } from '@/components/ui/primitives';
import { cn } from '@/utils/cn';

export interface View {
  zoom: number;
  x: number;
  y: number;
}

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.5;
const clamp = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** Pannable, zoomable surface. Drag empty space to pan, wheel to zoom around the cursor. Elements with data-no-pan handle their own pointer events. */
export function PanZoom({
  children,
  contentWidth,
  contentHeight,
  onResetLayout,
  resetLayoutLabel = 'Reset layout',
  className,
}: {
  children: (view: View) => ReactNode;
  contentWidth: number;
  contentHeight: number;
  onResetLayout?: () => void;
  resetLayoutLabel?: string;
  className?: string;
}) {
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; sx: number; sy: number; ox: number; oy: number } | null>(null);
  const [panning, setPanning] = useState(false);

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    setView((v) => {
      const rect = ref.current?.getBoundingClientRect();
      const px = cx ?? (rect ? rect.width / 2 : 0);
      const py = cy ?? (rect ? rect.height / 2 : 0);
      const zoom = clamp(v.zoom * factor);
      const k = zoom / v.zoom;
      return { zoom, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
    });
  }, []);

  const fit = useCallback(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || !contentWidth || !contentHeight) return setView({ zoom: 1, x: 0, y: 0 });
    const zoom = clamp(Math.min(rect.width / contentWidth, rect.height / contentHeight, 1));
    setView({ zoom, x: (rect.width - contentWidth * zoom) / 2, y: (rect.height - contentHeight * zoom) / 2 });
  }, [contentWidth, contentHeight]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
        zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - rect.left, e.clientY - rect.top);
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
    };
  }, [zoomAt]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement) !== e.currentTarget) return;
    const step = 40;
    if (e.key === '+' || e.key === '=') zoomAt(1.2);
    else if (e.key === '-') zoomAt(1 / 1.2);
    else if (e.key === '0') setView({ zoom: 1, x: 0, y: 0 });
    else if (e.key === 'ArrowLeft') setView((v) => ({ ...v, x: v.x + step }));
    else if (e.key === 'ArrowRight') setView((v) => ({ ...v, x: v.x - step }));
    else if (e.key === 'ArrowUp') setView((v) => ({ ...v, y: v.y + step }));
    else if (e.key === 'ArrowDown') setView((v) => ({ ...v, y: v.y - step }));
    else return;
    e.preventDefault();
  };

  return (
    <div
      ref={ref}
      tabIndex={0}
      aria-label="Canvas. Drag to pan, scroll to zoom, plus and minus keys zoom, 0 resets."
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        if (e.button !== 0 || (e.target as HTMLElement).closest('[data-no-pan]')) return;
        drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setPanning(true);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        setView((v) => ({ ...v, x: d.ox + e.clientX - d.sx, y: d.oy + e.clientY - d.sy }));
      }}
      onPointerUp={(e) => {
        if (drag.current?.id === e.pointerId) drag.current = null;
        setPanning(false);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setPanning(false);
      }}
      className={cn('relative h-full w-full touch-none overflow-hidden bg-canvas outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40', panning ? 'cursor-grabbing' : 'cursor-grab', className)}
      style={{ backgroundImage: 'radial-gradient(var(--line) 1px, transparent 1px)', backgroundSize: `${22 * view.zoom}px ${22 * view.zoom}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
    >
      <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`, width: contentWidth, height: contentHeight }}>
        {children(view)}
      </div>
      <div data-no-pan className="absolute bottom-3 left-3 flex items-center gap-0.5 rounded-lg border border-line-strong bg-surface p-0.5 shadow-md">
        <IconButton icon={Minus} label="Zoom out (-)" size="sm" onClick={() => zoomAt(1 / 1.2)} disabled={view.zoom <= MIN_ZOOM} />
        <button type="button" onClick={() => setView({ zoom: 1, x: 0, y: 0 })} title="Reset zoom to 100% (0)" className="h-6 min-w-12 rounded px-1 font-mono text-[11px] text-fg-muted hover:bg-surface-2 hover:text-fg">
          {Math.round(view.zoom * 100)}%
        </button>
        <IconButton icon={Plus} label="Zoom in (+)" size="sm" onClick={() => zoomAt(1.2)} disabled={view.zoom >= MAX_ZOOM} />
        <span className="mx-0.5 h-4 w-px bg-line" />
        <IconButton icon={Maximize} label="Fit to screen" size="sm" onClick={fit} />
        {onResetLayout ? <IconButton icon={LayoutGrid} label={resetLayoutLabel} size="sm" onClick={onResetLayout} /> : null}
      </div>
    </div>
  );
}
