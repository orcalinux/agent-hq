import { useEffect, useState, type CSSProperties } from 'react';
import { Menu } from 'lucide-react';
import { desktopApi, statusFrom } from '@/desktop/bridge';
import { TITLE_BAR_HEIGHT } from '@/desktop/types';
import { useAgentStore } from '@/store/useAgentStore';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { StatusDot } from '@/components/ui/primitives';
import { cn } from '@/utils/cn';
import { ApprovalModeBadge } from './ApprovalMode';

interface Insets {
  left: number;
  right: number;
}

interface ControlsOverlay extends EventTarget {
  visible: boolean;
  getTitlebarAreaRect: () => DOMRect;
}

function controlsOverlay(): ControlsOverlay | undefined {
  return (navigator as Navigator & { windowControlsOverlay?: ControlsOverlay }).windowControlsOverlay;
}

/** Room the native window buttons take: traffic lights on the left (macOS), the overlay on the right (Windows, Linux). */
function useControlInsets(platform: string): Insets {
  const fallback: Insets = platform === 'darwin' ? { left: 78, right: 0 } : { left: 0, right: 140 };
  const [insets, setInsets] = useState<Insets>(fallback);
  useEffect(() => {
    const overlay = controlsOverlay();
    if (!overlay || platform === 'darwin') return;
    const measure = () => {
      const rect = overlay.getTitlebarAreaRect();
      if (overlay.visible && rect.width > 0) setInsets({ left: Math.max(0, rect.x), right: Math.max(0, window.innerWidth - rect.x - rect.width) });
    };
    measure();
    overlay.addEventListener('geometrychange', measure);
    window.addEventListener('resize', measure);
    return () => {
      overlay.removeEventListener('geometrychange', measure);
      window.removeEventListener('resize', measure);
    };
  }, [platform]);
  return insets;
}

const drag = { WebkitAppRegion: 'drag' } as CSSProperties;
const noDrag = { WebkitAppRegion: 'no-drag' } as CSSProperties;

/** The desktop app's title bar: drag area, application menu, project name and live run status. */
export function TitleBar() {
  const api = desktopApi();
  const platform = api?.platform ?? 'linux';
  const insets = useControlInsets(platform);
  const project = useWorkspaceStore((s) => s.name);
  const status = useAgentStore((s) => statusFrom(s).label);
  const running = useAgentStore((s) => statusFrom(s).running);
  if (!api) return null;

  return (
    <header
      className="relative flex shrink-0 select-none items-center border-b border-line bg-surface text-[12px] text-fg-muted"
      style={{ ...drag, height: TITLE_BAR_HEIGHT, paddingLeft: insets.left + 6, paddingRight: insets.right + 8 }}
      onDoubleClick={(e) => e.preventDefault()}
      data-testid="desktop-title-bar"
    >
      {platform !== 'darwin' ? (
        <button
          type="button"
          aria-label="Application menu"
          title="Menu"
          style={noDrag}
          className="flex h-7 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            api.showMenu(rect.left, rect.bottom);
          }}
        >
          <Menu className="h-4 w-4" />
        </button>
      ) : null}
      <div className="ml-1.5 flex min-w-0 items-center gap-1.5">
        {project ? <span className="truncate font-medium text-fg">{project}</span> : null}
        {project ? <span className="text-fg-subtle">—</span> : null}
        <span className="shrink-0">Agent HQ</span>
      </div>
      <div className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5" aria-live="polite">
        <span className={cn('flex items-center gap-1.5 rounded-full px-2.5 py-0.5', running ? 'bg-accent-soft text-fg' : 'text-fg-subtle')}>
          <StatusDot tone={running ? 'success' : 'neutral'} />
          {status}
        </span>
      </div>
      <div className="ml-auto flex items-center" style={noDrag}>
        <ApprovalModeBadge />
      </div>
    </header>
  );
}
