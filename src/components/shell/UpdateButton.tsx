import { ArrowUp, Clock, X } from 'lucide-react';
import { statusFrom } from '@/desktop/bridge';
import { fmtSize, updateButtonState, useUpdateStore } from '@/desktop/useUpdate';
import { useAgentStore } from '@/store/useAgentStore';
import { cn } from '@/utils/cn';

/**
 * The title bar's Update pill. It appears once a newer version is downloaded (or found, when
 * automatic download is off), shows what changed before restarting, and its × hides it for 3 days.
 */
export function UpdateButton() {
  const state = useUpdateStore((s) => s.state);
  const prefs = useUpdateStore((s) => s.prefs);
  const pulling = useUpdateStore((s) => s.pulling);
  const openNotes = useUpdateStore((s) => s.openNotes);
  const download = useUpdateStore((s) => s.download);
  const hide = useUpdateStore((s) => s.hideButton);
  const busy = useAgentStore((s) => statusFrom(s).busy);
  const kind = updateButtonState(state, prefs, pulling);
  if (!kind || !state) return null;

  const v = state.version ?? '';
  const percent = Math.max(0, Math.min(100, state.percent ?? 0));
  const label = { ready: 'Update', waiting: 'Waiting to update', available: 'Update', failed: 'Update failed', downloading: `Downloading… ${percent}%` }[kind];
  const title = {
    ready: `Restart to update to v${v}`,
    waiting: `Restarts to update to v${v} once the agents finish (${busy} working). Click to restart now.`,
    available: `v${v} is out${state.size ? ` · ${fmtSize(state.size)}` : ''} · Click to download and restart`,
    failed: `Couldn't download v${v} · Click to try again${state.error ? `\n${state.error}` : ''}`,
    downloading: `Downloading v${v}`,
  }[kind];
  const onClick = () => {
    if (kind === 'ready' || kind === 'waiting') openNotes('confirm');
    else if (kind === 'available' || kind === 'failed') download(true);
  };
  const Icon = kind === 'waiting' ? Clock : ArrowUp;

  return (
    <div className="group/update relative mr-2 inline-flex">
      <button
        type="button"
        title={title}
        aria-label={title}
        data-testid="update-button"
        data-kind={kind}
        onClick={onClick}
        disabled={kind === 'downloading'}
        className={cn(
          'ahq-update-in relative inline-flex h-[22px] max-w-[16em] items-center gap-1 overflow-hidden whitespace-nowrap rounded-full pl-[7px] pr-[9px] text-[11.5px] font-semibold tracking-[0.005em]',
          'bg-accent-soft text-accent shadow-[inset_0_0_0_0.5px_color-mix(in_srgb,var(--accent)_35%,transparent)]',
          'transition-[background-color,color,transform,opacity] duration-150 hover:bg-accent hover:text-accent-fg active:scale-[0.96]',
          'disabled:pointer-events-none',
          kind === 'failed' && 'bg-danger-soft text-danger shadow-[inset_0_0_0_0.5px_color-mix(in_srgb,var(--danger)_35%,transparent)] hover:bg-danger hover:text-white'
        )}
      >
        {kind === 'downloading' ? (
          <span aria-hidden className="absolute inset-y-0 left-0 bg-accent/15 transition-[width] duration-300 ease-out" style={{ width: `${percent}%` }} />
        ) : null}
        <Icon className="relative h-[11px] w-[11px]" strokeWidth={2.6} />
        <span className="relative tabular-nums">{label}</span>
      </button>
      {kind !== 'downloading' ? (
        <button
          type="button"
          aria-label="Hide for 3 days"
          title="Hide for 3 days"
          data-testid="update-hide"
          onClick={hide}
          className="absolute -right-[3px] -top-[6px] flex h-3.5 w-3.5 items-center justify-center rounded-full bg-surface text-fg-subtle opacity-0 shadow-[0_0_0_1px_var(--line),0_1px_2px_rgba(0,0,0,0.12)] transition-opacity duration-150 hover:text-fg focus-visible:opacity-100 group-hover/update:opacity-100"
        >
          <X className="h-2 w-2" strokeWidth={2.5} />
        </button>
      ) : null}
    </div>
  );
}
