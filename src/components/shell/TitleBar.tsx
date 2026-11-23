import { useEffect, useState, type CSSProperties } from 'react';
import { Copy, Minus, Square, X } from 'lucide-react';
import { desktopApi, statusFrom } from '@/desktop/bridge';
import { TITLE_BAR_HEIGHT } from '@/desktop/types';
import { useAgentStore } from '@/store/useAgentStore';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { StatusDot } from '@/components/ui/primitives';
import { cn } from '@/utils/cn';
import { ApprovalModeBadge } from './ApprovalMode';
import { UpdateButton } from './UpdateButton';
import { ApplicationMenu } from './ApplicationMenu';
import { CheckForUpdatesButton } from './UpdateCenter';

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
  const fallback: Insets = platform === 'darwin' ? { left: 78, right: 0 } : platform === 'linux' ? { left: 0, right: 0 } : { left: 0, right: 140 };
  const [insets, setInsets] = useState<Insets>(fallback);
  useEffect(() => {
    const overlay = controlsOverlay();
    if (!overlay || platform === 'darwin' || platform === 'linux') return;
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

function WindowButton({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      style={noDrag}
      className={cn(
        'flex h-full w-11 items-center justify-center text-fg-muted transition-colors duration-150 focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-accent',
        danger ? 'hover:bg-danger hover:text-white active:bg-danger/80' : 'hover:bg-surface-3 hover:text-fg active:bg-surface-2'
      )}
    >
      {children}
    </button>
  );
}

/** Minimize, maximize and close, drawn by the app so they match the theme and sit inside the title bar's border. */
function LinuxWindowControls() {
  const api = desktopApi();
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!api) return;
    let live = true;
    void api.isMaximized().then((value) => live && setMaximized(value)).catch(() => undefined);
    const off = api.onMaximized(setMaximized);
    return () => { live = false; off(); };
  }, [api]);
  if (!api) return null;
  return (
    <div className="ml-2 flex h-full shrink-0 items-stretch" style={noDrag}>
      <WindowButton label="Minimize" onClick={() => api.windowControl('minimize')}><Minus className="h-4 w-4" strokeWidth={1.75} /></WindowButton>
      <WindowButton label={maximized ? 'Restore' : 'Maximize'} onClick={() => api.windowControl('toggle-maximize')}>
        {maximized ? <Copy className="h-3.5 w-3.5 -scale-x-100" strokeWidth={1.75} /> : <Square className="h-3.5 w-3.5" strokeWidth={1.75} />}
      </WindowButton>
      <WindowButton label="Close" danger onClick={() => api.windowControl('close')}><X className="h-4 w-4" strokeWidth={1.75} /></WindowButton>
    </div>
  );
}

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
      style={{ ...drag, height: TITLE_BAR_HEIGHT, paddingLeft: insets.left + 6, paddingRight: platform === 'linux' ? 0 : insets.right + 8 }}
      onDoubleClick={(e) => e.preventDefault()}
      data-testid="desktop-title-bar"
    >
      {platform !== 'darwin' ? <ApplicationMenu /> : null}
      <div className="ml-1.5 flex min-w-0 max-w-[32%] items-center gap-1.5 whitespace-nowrap">
        {project ? <span className="min-w-0 truncate font-medium text-fg">{project}</span> : null}
        {project ? <span className="shrink-0 text-fg-subtle">—</span> : null}
        <span className="shrink-0">Agent HQ</span>
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5 px-2" aria-live="polite">
        <span className={cn('flex min-w-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5', running ? 'bg-accent-soft text-fg' : 'text-fg-subtle')}>
          <StatusDot tone={running ? 'success' : 'neutral'} />
          <span className="min-w-0 truncate">{status}</span>
        </span>
      </div>
      <div className="ml-auto flex shrink-0 items-center" style={noDrag}>
        <UpdateButton />
        <CheckForUpdatesButton />
        <ApprovalModeBadge />
      </div>
      {platform === 'linux' ? <LinuxWindowControls /> : null}
    </header>
  );
}
