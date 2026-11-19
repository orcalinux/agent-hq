import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useConnectionsStore } from '@/store/useConnectionsStore';
import { CONNECTION_METHOD_LABEL, type AIProviderId, type ProviderState } from '@/types';
import { Badge, Button, StatusDot } from '@/components/ui/primitives';
import { fmtRelative } from '@/components/ui/helpers';

function ProviderRow({ provider, onConnect }: { provider: ProviderState; onConnect: (id: AIProviderId) => void }) {
  const refresh = useConnectionsStore((s) => s.refresh);
  const disconnect = useConnectionsStore((s) => s.disconnect);
  const refreshing = useConnectionsStore((s) => s.refreshing[provider.id]);
  const exhaustedUntil = useConnectionsStore((s) => s.exhausted[provider.id]);
  const clearExhausted = useConnectionsStore((s) => s.clearExhausted);
  const c = provider.connection;
  const exhausted = Boolean(exhaustedUntil && exhaustedUntil > Date.now());
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <tr className="border-b border-line align-top">
      <td className="px-3 py-2">
        <div className="font-medium">{provider.name}</div>
        <div className="text-[11.5px] text-fg-subtle">{provider.methods.map((m) => CONNECTION_METHOD_LABEL[m]).join(' · ')}</div>
      </td>
      <td className="px-3 py-2">
        {c ? CONNECTION_METHOD_LABEL[c.method] : '—'}
        {c?.maskedKey ? <span className="ml-1 font-mono text-[11px] text-fg-subtle">{c.maskedKey}</span> : null}
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusDot tone={c ? (c.lastError ? 'danger' : 'success') : 'neutral'} />
          <span>{c ? (c.lastError ? 'Error' : 'Connected') : 'Not connected'}</span>
          {exhausted ? <Badge tone="warning" title="Reached its credit or rate limit. Agents are rerouted to other providers.">Out of credit</Badge> : null}
        </div>
        {c?.lastError ? <p className="mt-0.5 max-w-xs break-words text-[11.5px] text-danger">{c.lastError}</p> : null}
        {msg ? <p className="mt-0.5 max-w-xs break-words text-[11.5px] text-fg-muted">{msg}</p> : null}
      </td>
      <td className="px-3 py-2 tabular-nums">{c ? provider.models.length : '—'}</td>
      <td className="px-3 py-2 text-fg-muted">{c ? fmtRelative(c.lastVerifiedAt ? Date.parse(c.lastVerifiedAt) : undefined) : '—'}</td>
      <td className="px-3 py-2">
        <div className="flex justify-end gap-1.5">
          {c ? (
            <>
              <Button
                size="sm"
                icon={RefreshCw}
                loading={refreshing}
                onClick={async () => {
                  const r = await refresh(provider.id);
                  setMsg(r.ok ? 'Verified just now.' : (r.error ?? 'Failed.'));
                }}
              >
                Verify
              </Button>
              {exhausted ? <Button size="sm" onClick={() => clearExhausted(provider.id)}>Retry now</Button> : null}
              <Button size="sm" onClick={() => onConnect(provider.id)}>Reconnect</Button>
              <Button size="sm" variant="danger" onClick={() => void disconnect(provider.id)}>Disconnect</Button>
            </>
          ) : (
            <Button size="sm" variant="primary" onClick={() => onConnect(provider.id)}>Connect</Button>
          )}
        </div>
      </td>
    </tr>
  );
}

export function ProviderTable({ onConnect }: { onConnect: (id: AIProviderId) => void }) {
  const providers = useConnectionsStore((s) => s.providers);
  const loading = useConnectionsStore((s) => s.loading);
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="w-full text-left text-[12.5px]">
        <thead className="border-b border-line bg-surface-2 text-[11.5px] uppercase tracking-wide text-fg-subtle">
          <tr>
            {['Provider', 'Method', 'Status', 'Models', 'Last verified', ''].map((h, i) => (
              <th key={i} className="px-3 py-1.5 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {providers.map((p) => <ProviderRow key={p.id} provider={p} onConnect={onConnect} />)}
          {providers.length === 0 ? (
            <tr><td colSpan={6} className="px-3 py-6 text-center text-fg-subtle">{loading ? 'Loading…' : 'No providers loaded.'}</td></tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

export function LocalTools() {
  const detection = useConnectionsStore((s) => s.detection);
  const detecting = useConnectionsStore((s) => s.detecting);
  const detect = useConnectionsStore((s) => s.detect);
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <h2 className="text-[13px] font-semibold">Local tools</h2>
          <p className="text-[12px] text-fg-muted">Detected on this computer. A signed-in CLI is the supported way to use an existing subscription.</p>
        </div>
        <Button size="sm" icon={RefreshCw} loading={detecting} onClick={() => void detect()}>Re-detect</Button>
      </div>
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full text-left text-[12.5px]">
          <thead className="border-b border-line bg-surface-2 text-[11.5px] uppercase tracking-wide text-fg-subtle">
            <tr>
              <th className="px-3 py-1.5 font-medium">Tool</th>
              <th className="px-3 py-1.5 font-medium">Status</th>
              <th className="px-3 py-1.5 font-medium">Sign-in</th>
              <th className="px-3 py-1.5 font-medium">Used for</th>
            </tr>
          </thead>
          <tbody>
            {detection?.clis.map((cli) => (
              <tr key={cli.binary} className="border-b border-line last:border-0">
                <td className="px-3 py-1.5 font-mono">{cli.binary}</td>
                <td className="px-3 py-1.5">
                  <span className="flex items-center gap-1.5">
                    <StatusDot tone={cli.detected ? 'success' : 'neutral'} />
                    {cli.detected ? 'Installed' + (cli.version ? ' · ' + cli.version : '') : 'Not installed'}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-fg-muted">
                  {cli.detected ? (cli.auth?.checked ? (cli.auth.detail ?? (cli.auth.ok ? 'Signed in' : 'Not signed in')) : 'Verified when you connect') : '—'}
                </td>
                <td className="px-3 py-1.5 text-fg-muted">{cli.purpose}{!cli.executionSupported ? ' (not supported for model calls)' : ''}</td>
              </tr>
            ))}
            <tr>
              <td className="px-3 py-1.5 font-mono">ollama</td>
              <td className="px-3 py-1.5" colSpan={3}>
                <span className="flex items-center gap-1.5">
                  <StatusDot tone={detection?.ollama.reachable ? 'success' : 'neutral'} />
                  {detection
                    ? detection.ollama.reachable
                      ? 'Running at ' + detection.ollama.endpoint + ' · ' + (detection.ollama.models ?? 0) + ' models installed'
                      : 'Not reachable at ' + detection.ollama.endpoint
                    : 'Detecting…'}
                </span>
              </td>
            </tr>
            <tr className="border-t border-line">
              <td className="px-3 py-1.5 font-mono">magpie</td>
              <td className="px-3 py-1.5" colSpan={3}>
                <span className="flex items-center gap-1.5">
                  <StatusDot tone={detection?.magpie?.reachable ? 'success' : 'neutral'} />
                  {detection
                    ? detection.magpie?.reachable
                      ? 'Gateway at ' + detection.magpie.endpoint + ' · ' + (detection.magpie.models ?? 0) + ' models and routing groups'
                      : 'Gateway not reachable' + (detection.magpie ? ' at ' + detection.magpie.endpoint : '')
                    : 'Detecting…'}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
