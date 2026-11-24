import { useCallback, useEffect, useState } from 'react';
import { api } from '@/api/client';
import { useAgentStore } from '@/store/useAgentStore';
import { Badge, Button, StatusDot, Tabs } from '@/components/ui/primitives';
import type { ComputerAccess, ComputerStatus } from '@/types/computerUse';

const GUIDE = 'https://github.com/trycua/cua';

export function ComputerAccessSettings() {
  const running = useAgentStore((state) => state.isLiveRunning);
  const [status, setStatus] = useState<ComputerStatus | null>(null);
  const [pending, setPending] = useState<ComputerAccess | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(() => {
    void api.computerStatus().then(setStatus).catch((cause) => setError((cause as Error).message));
  }, []);
  useEffect(refresh, [refresh]);

  const apply = async (access: ComputerAccess) => {
    setSaving(true);
    setError('');
    try {
      setStatus(await api.setComputerAccess(access));
      setPending(null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const choose = (access: ComputerAccess) => {
    if (access === status?.access) return setPending(null);
    if (access === 'off') return void apply('off');
    setPending(access);
  };
  const failing = status?.probes?.filter((probe) => probe.status !== 'ok') ?? [];

  return (
    <div className="space-y-2" data-testid="computer-access-settings">
      <div className="flex min-w-0 items-center gap-2">
        <p className="min-w-0 truncate text-[12px] font-medium text-fg-muted">Desktop access</p>
        {status?.installed ? (
          <Badge tone={status.ready ? (status.running ? 'success' : 'neutral') : 'warning'}>
            <StatusDot tone={status.ready ? (status.running ? 'success' : 'neutral') : 'warning'} />
            {!status.ready ? 'Needs setup' : status.running ? 'Driver running' : 'Ready'}
          </Badge>
        ) : null}
        {status?.version ? <span className="font-mono text-[11px] text-fg-subtle">Cua Driver {status.version}</span> : null}
      </div>
      {!status ? null : !status.installed ? (
        <p className="text-[11.5px] leading-relaxed text-fg-subtle">
          Install Cua Driver to let agents read and operate desktop apps through accessibility. Agent HQ never installs it for you.{' '}
          <a href={GUIDE} target="_blank" rel="noreferrer" className="text-accent hover:underline">Installation guide</a>
          <Button size="sm" className="ml-2" onClick={refresh}>Check again</Button>
        </p>
      ) : (
        <>
          <fieldset disabled={saving} className="min-w-0 disabled:opacity-50">
            <Tabs<ComputerAccess>
              label="Desktop access"
              value={pending ?? status.access}
              onChange={choose}
              items={[{ id: 'off', label: 'Off' }, { id: 'read', label: 'Read windows', disabled: running || !status.ready }, { id: 'control', label: 'Read and control', disabled: running || !status.ready }]}
            />
          </fieldset>
          {pending ? (
            <div role="alertdialog" aria-label="Confirm desktop access" className="space-y-2 rounded-lg border border-warning/40 bg-warning-soft/40 p-3">
              <p className="text-[12px] leading-relaxed text-fg">
                {pending === 'control'
                  ? 'Agents will be able to click, type, press keys and scroll in apps on this desktop. Actions are logged, run one at a time, and require inspection before retrying after an interruption.'
                  : 'Agents will be able to read the window list and the text of on-screen apps, including anything private shown in them.'}
              </p>
              <div className="flex gap-2">
                <Button variant="primary" size="sm" onClick={() => void apply(pending)}>{pending === 'control' ? 'Allow control' : 'Allow reading'}</Button>
                <Button size="sm" onClick={() => setPending(null)}>Cancel</Button>
              </div>
            </div>
          ) : null}
          <p className="text-[11.5px] leading-relaxed text-fg-subtle">
            Off by default. Agent HQ starts its own private driver only while access is on and stops it when you turn access off. Agents see the accessibility tree as text, never screenshots, and cannot use pixel clicks, files, scripts or the clipboard.
          </p>
          {failing.length ? (
            <ul className="space-y-0.5 text-[11.5px] text-warning">
              {failing.map((probe) => <li key={probe.label} className="truncate" title={probe.message}>{probe.label}: {probe.message}</li>)}
            </ul>
          ) : null}
        </>
      )}
      {running ? <p className="text-[11.5px] text-fg-subtle">You can turn access off at any time. Stop the current run before enabling or changing access.</p> : null}
      {status?.error ? <p role="alert" className="text-[12px] text-danger">{status.error}</p> : null}
      {error ? <p role="alert" className="text-[12px] text-danger">{error}</p> : null}
    </div>
  );
}
