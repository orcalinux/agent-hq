import { ArrowDownToLine, ArrowUp, Check, CircleAlert, ExternalLink, RefreshCw, Settings2 } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/primitives';
import { desktopApi } from '@/desktop/bridge';
import { fmtSize, RELEASES_URL, useUpdateStore } from '@/desktop/useUpdate';
import { useAgentStore } from '@/store/useAgentStore';
import { cn } from '@/utils/cn';

export function UpdateCenter() {
  const state = useUpdateStore((store) => store.state);
  const open = useUpdateStore((store) => store.centerOpen);
  const close = useUpdateStore((store) => store.closeCenter);
  const check = useUpdateStore((store) => store.check);
  const download = useUpdateStore((store) => store.download);
  const openNotes = useUpdateStore((store) => store.openNotes);
  const prefs = useUpdateStore((store) => store.prefs);
  const status = state?.status ?? 'idle';
  const busy = status === 'checking' || status === 'downloading';
  const newer = status === 'available' || status === 'downloading' || status === 'ready' || (status === 'error' && Boolean(state?.version));
  const percent = Math.max(0, Math.min(100, state?.percent ?? 0));
  const Icon = busy ? RefreshCw : status === 'up-to-date' ? Check : status === 'error' ? CircleAlert : ArrowUp;
  const title = {
    idle: 'Check for a newer version',
    unsupported: 'You’re running a development build',
    checking: 'Looking for updates…',
    'up-to-date': 'You’re up to date',
    available: 'A new version is available',
    downloading: 'Downloading your update…',
    ready: 'Your update is ready',
    error: 'The update couldn’t complete',
  }[status];
  const detail = {
    idle: 'You can check at any time, even with automatic checks turned off.',
    unsupported: 'Automatic installation is available in installed desktop builds. You can browse published releases below.',
    checking: 'Checking GitHub Releases for the latest Agent HQ.',
    'up-to-date': 'You have the latest published version of Agent HQ.',
    available: 'Read what changed, then download when you’re ready.',
    downloading: 'You can close this window and keep working. We’ll let you know when it’s ready.',
    ready: state?.waiting ? 'The app will restart when the agents finish.' : 'Review the release notes before restarting. Your projects and settings are kept.',
    error: 'Check your connection and try again. Your current installation is kept.',
  }[status];
  const settings = () => {
    close();
    useUpdateStore.setState({ settingsRequested: true });
    useAgentStore.getState().setActiveView('settings');
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Agent HQ updates"
      description={`Installed version ${state?.current ?? __APP_VERSION__}`}
      footer={
        <>
          <Button variant="ghost" icon={Settings2} onClick={settings}>Update settings</Button>
          <div className="flex-1" />
          {status === 'unsupported' ? (
            <a href={RELEASES_URL} target="_blank" rel="noreferrer" className="ahq-button inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1 text-[12px] font-medium text-accent-fg">View releases <ExternalLink className="h-3.5 w-3.5" /></a>
          ) : status === 'ready' ? (
            <Button variant="primary" icon={ArrowUp} onClick={() => openNotes('confirm')}>Review and restart</Button>
          ) : status === 'available' || (status === 'error' && state?.version) ? (
            <Button variant="primary" icon={ArrowDownToLine} onClick={() => download()}>Download update</Button>
          ) : (
            <Button variant="primary" loading={busy} icon={RefreshCw} onClick={check}>{busy ? status === 'downloading' ? 'Downloading' : 'Checking' : status === 'error' ? 'Try again' : 'Check again'}</Button>
          )}
        </>
      }
    >
      <div className="py-3" data-testid="update-center">
        <div className="flex items-start gap-4" role="status" aria-live="polite" aria-atomic="true">
          <div className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-accent/20 bg-accent-soft text-accent', status === 'up-to-date' && 'border-success/20 bg-success-soft text-success', status === 'error' && 'border-danger/20 bg-danger-soft text-danger')}>
            <Icon className={cn('h-5 w-5', busy && 'animate-spin motion-reduce:animate-none')} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
            <p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">{detail}</p>
            {newer ? <p className="mt-2 font-mono text-[12px] text-fg">v{state?.current} → v{state?.version}{state?.size ? ` · ${fmtSize(state.size)}` : ''}</p> : null}
            {state?.checkedAt && !busy ? <p className="mt-2 text-[11px] text-fg-subtle">Last checked {new Date(state.checkedAt).toLocaleString()}</p> : null}
          </div>
        </div>
        {status === 'downloading' ? (
          <div className="mt-5">
            <div role="progressbar" aria-label="Update download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-accent transition-[width] duration-150 motion-reduce:transition-none" style={{ width: `${percent}%` }} />
            </div>
            <p className="mt-1.5 text-right text-[11px] tabular-nums text-fg-subtle">{percent}%</p>
          </div>
        ) : null}
        {status === 'error' && state?.error ? <p className="mt-4 max-h-24 overflow-auto rounded-lg border border-danger/20 bg-danger-soft p-3 text-[12px] text-danger [overflow-wrap:anywhere]">{state.error}</p> : null}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-[11.5px] text-fg-subtle">
          <span>{prefs.auto ? `Automatic checks every ${prefs.everyHours} ${prefs.everyHours === 1 ? 'hour' : 'hours'}` : 'Automatic checks are off'}</span>
          <Button variant="ghost" size="sm" onClick={() => openNotes('browse')}>What’s new</Button>
        </div>
      </div>
    </Dialog>
  );
}

export function CheckForUpdatesButton() {
  const check = useUpdateStore((store) => store.check);
  const busy = useUpdateStore((store) => store.state?.status === 'checking');
  if (!desktopApi()) return null;
  return (
    <button type="button" title="Check for updates" aria-label="Check for updates" onClick={check} className="ahq-icon-button mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg focus-visible:outline focus-visible:outline-accent">
      <RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin motion-reduce:animate-none')} />
    </button>
  );
}
