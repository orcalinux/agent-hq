import { useEffect, useState, type ReactNode } from 'react';
import { isDesktop } from '@/desktop/bridge';
import { fmtSize, useUpdateStore } from '@/desktop/useUpdate';
import type { UpdatePrefs, UpdateState } from '@/desktop/types';
import { Button, StatusDot, Tabs } from '@/components/ui/primitives';
import { cn } from '@/utils/cn';
import { AgentUpdatesSettings } from './AgentUpdatesSettings';

function Row({ label, hint, children, off, testId }: { label: string; hint?: ReactNode; children: ReactNode; off?: boolean; testId?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3 transition-opacity', off && 'opacity-45')} data-testid={testId}>
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium text-fg">{label}</p>
        {hint ? <p className="mt-0.5 text-[11.5px] leading-relaxed text-fg-subtle">{hint}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

function OnOff({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className={cn(disabled && 'pointer-events-none')}>
      <Tabs<'on' | 'off'> label={label} value={value ? 'on' : 'off'} onChange={(v) => onChange(v === 'on')} items={[{ id: 'off', label: 'Off' }, { id: 'on', label: 'On' }]} />
    </div>
  );
}

function ago(at?: number, now = Date.now()): string {
  if (!at) return '';
  const min = Math.round((now - at) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

function statusLine(s: UpdateState | null): { text: string; tone: 'neutral' | 'success' | 'accent' | 'warning' | 'danger' } {
  if (!s || s.status === 'idle') return { text: 'Not checked yet', tone: 'neutral' };
  switch (s.status) {
    case 'unsupported':
      return { text: 'Updates are checked in installed builds (AppImage, .deb, .rpm, Windows, macOS)', tone: 'neutral' };
    case 'checking':
      return { text: 'Checking for updates…', tone: 'accent' };
    case 'up-to-date':
      return { text: `Up to date · checked ${ago(s.checkedAt)}`, tone: 'success' };
    case 'available':
      return { text: `v${s.version} is out${s.size ? ` · ${fmtSize(s.size)}` : ''}`, tone: 'accent' };
    case 'downloading':
      return { text: `Downloading v${s.version} · ${s.percent ?? 0}%`, tone: 'accent' };
    case 'ready':
      return { text: s.waiting ? `v${s.version} is ready · restarts once the agents finish` : `v${s.version} is downloaded and ready`, tone: 'success' };
    case 'error':
      return { text: `Couldn't ${s.version ? `download v${s.version}` : 'check for updates'}${s.error ? ` · ${s.error.split('\n')[0].slice(0, 140)}` : ''}`, tone: 'danger' };
  }
}

/** Settings › Updates: the version, what changed, and how updates arrive. */
export function UpdatesSettings() {
  const state = useUpdateStore((s) => s.state);
  const prefs = useUpdateStore((s) => s.prefs);
  const setPrefs = useUpdateStore((s) => s.setPrefs);
  const check = useUpdateStore((s) => s.check);
  const download = useUpdateStore((s) => s.download);
  const openNotes = useUpdateStore((s) => s.openNotes);
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const desktop = isDesktop();
  const version = state?.current ?? __APP_VERSION__;
  const line = statusLine(desktop ? state : { status: 'unsupported', current: version });
  const busy = state?.status === 'checking' || state?.status === 'downloading';
  const set = (next: Partial<UpdatePrefs>) => void setPrefs(next);
  const hidden = Boolean(prefs.hiddenUntil && prefs.hiddenUntil > Date.now());

  let action: ReactNode = null;
  if (desktop && state && state.status !== 'unsupported') {
    if (state.status === 'ready') action = <Button variant="primary" size="sm" onClick={() => openNotes('confirm')}>Restart to update</Button>;
    else if (state.status === 'available' || (state.status === 'error' && state.version)) action = <Button variant="primary" size="sm" onClick={() => download()}>Download update</Button>;
    else action = <Button size="sm" loading={busy} onClick={check} data-testid="update-check">Check now</Button>;
  }

  return (
    <div className="-my-3 divide-y divide-line" data-testid="settings-updates">
      <Row
        label="Version"
        testId="update-version-row"
        hint={
          <span className="inline-flex items-center gap-1.5">
            <StatusDot tone={line.tone} pulse={busy} />
            <span data-testid="update-status">{line.text}</span>
          </span>
        }
      >
        <span className="rounded-md border border-line bg-surface-2 px-2 py-0.5 font-mono text-[12px] text-fg">v{version}</span>
        {action}
      </Row>
      {state?.status === 'downloading' ? (
        <div className="pb-3">
          <div className="h-1 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out" style={{ width: `${state.percent ?? 0}%` }} />
          </div>
        </div>
      ) : null}
      <Row label="What's new" hint="The release notes for this version and the ones before it">
        <Button size="sm" onClick={() => openNotes('browse')} data-testid="whats-new-open">Open</Button>
      </Row>
      <div className="py-3"><AgentUpdatesSettings /></div>
      {desktop ? (
        <>
          <Row label="Update button" hint={hidden ? 'Hidden for 3 days from the title bar' : 'Shows in the title bar when a newer version is ready'}>
            {hidden ? <Button size="sm" variant="ghost" onClick={() => set({ hiddenUntil: 0, hiddenVersion: undefined })}>Show again</Button> : null}
            <OnOff label="Update button" value={prefs.showButton} onChange={(showButton) => set({ showButton })} />
          </Row>
          <Row label="Automatic updates" hint="Checks for a newer Agent HQ by itself. Off, only Check now asks.">
            <OnOff label="Automatic updates" value={prefs.auto} onChange={(auto) => set({ auto })} />
          </Row>
          <Row label="Check every" hint={prefs.auto ? 'How often Agent HQ looks for a newer version' : 'While automatic updates are on'} off={!prefs.auto}>
            <div className={cn(!prefs.auto && 'pointer-events-none')}>
              <Tabs<string>
                label="Check every"
                value={String(prefs.everyHours)}
                onChange={(v) => set({ everyHours: Number(v) as UpdatePrefs['everyHours'] })}
                items={[{ id: '1', label: '1 h' }, { id: '6', label: '6 h' }, { id: '12', label: '12 h' }, { id: '24', label: '24 h' }]}
              />
            </div>
          </Row>
          <Row
            label="Download automatically"
            hint={prefs.autoDownload ? 'Downloads a newer version as soon as it is found. Turn off on a metered network.' : 'Off: a newer version is only shown, with its size, and downloads when you click Update.'}
          >
            <OnOff label="Download automatically" value={prefs.autoDownload} onChange={(autoDownload) => set({ autoDownload })} />
          </Row>
          <Row label="Restart automatically" hint="Once an update is downloaded, restarts into it when no agent is working, so a run is never cut short.">
            <OnOff label="Restart automatically" value={prefs.autoRestart} onChange={(autoRestart) => set({ autoRestart })} />
          </Row>
        </>
      ) : (
        <Row label="Updates" hint={<>In the browser version, update with <code className="font-mono">git pull</code> and <code className="font-mono">npm install</code>. The desktop app updates itself.</>}>
          <span />
        </Row>
      )}
    </div>
  );
}
