import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useConnectionsStore } from '@/store/useConnectionsStore';
import { CONNECTION_METHOD_LABEL, type AIProviderId, type ProviderState } from '@/types';
import { Badge, Button, StatusDot } from '@/components/ui/primitives';
import { fmtRelative } from '@/components/ui/helpers';
import { cn } from '@/utils/cn';
import { InstallActions } from './InstallActions';

/** Columns that appear once the table has room. Everything stays in the provider's connect dialog. */
const COLUMN = { method: 'hidden @3xl:table-cell', models: 'hidden @2xl:table-cell', verified: 'hidden @4xl:table-cell' };
const TOOL_COLUMN = { signIn: 'hidden @4xl:table-cell' };

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
      <td className="w-full max-w-0 px-3 py-2">
        <div className="truncate font-medium">{provider.name}</div>
        <div className="truncate text-[11.5px] text-fg-subtle">{provider.methods.map((m) => CONNECTION_METHOD_LABEL[m]).join(' · ')}</div>
      </td>
      <td className={cn('px-3 py-2', COLUMN.method)}>
        <div className="max-w-48 truncate whitespace-nowrap">
          {c ? CONNECTION_METHOD_LABEL[c.method] : '—'}
          {c?.maskedKey ? <span className="ml-1 font-mono text-[11px] text-fg-subtle">{c.maskedKey}</span> : null}
        </div>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5 whitespace-nowrap">
          <StatusDot tone={c ? (c.lastError ? 'danger' : 'success') : 'neutral'} />
          <span className="min-w-0 truncate">{c ? (c.lastError ? 'Error' : 'Connected') : 'Not connected'}</span>
          {exhausted ? <Badge tone="warning" title="Reached its credit or rate limit. Agents are rerouted to other providers.">Out of credit</Badge> : null}
        </div>
        {c?.lastError ? <p className="mt-0.5 max-w-xs break-words text-[11.5px] text-danger">{c.lastError}</p> : null}
        {msg ? <p className="mt-0.5 max-w-xs break-words text-[11.5px] text-fg-muted">{msg}</p> : null}
      </td>
      <td className={cn('px-3 py-2 tabular-nums', COLUMN.models)}>{c ? provider.models.length : '—'}</td>
      <td className={cn('whitespace-nowrap px-3 py-2 text-fg-muted', COLUMN.verified)}>{c ? fmtRelative(c.lastVerifiedAt ? Date.parse(c.lastVerifiedAt) : undefined) : '—'}</td>
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
    <div className="@container overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
      <table className="w-full text-left text-[12.5px]">
        <thead className="border-b border-line bg-surface-2 text-[11.5px] uppercase tracking-wide text-fg-subtle">
          <tr>
            {([['Provider', ''], ['Method', COLUMN.method], ['Status', ''], ['Models', COLUMN.models], ['Last verified', COLUMN.verified], ['', '']] as const).map(([h, column], i) => (
              <th key={i} className={cn('px-3 py-1.5 font-medium', column)}>{h}</th>
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
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-[13px] font-semibold">Local tools</h2>
          <p className="truncate text-[12px] text-fg-muted">Detected on this computer. A signed-in CLI is the supported way to use an existing subscription.</p>
        </div>
        <Button size="sm" icon={RefreshCw} loading={detecting} onClick={() => void detect()}>Re-detect</Button>
      </div>
      <div className="@container overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
        <table className="w-full text-left text-[12.5px]">
          <thead className="border-b border-line bg-surface-2 text-[11.5px] uppercase tracking-wide text-fg-subtle">
            <tr>
              <th className="px-3 py-1.5 font-medium">Tool</th>
              <th className="px-3 py-1.5 font-medium">Status</th>
              <th className={cn('px-3 py-1.5 font-medium', TOOL_COLUMN.signIn)}>Sign-in</th>
              <th className="px-3 py-1.5 font-medium">Used for</th>
              <th className="px-3 py-1.5 font-medium">Install</th>
            </tr>
          </thead>
          <tbody>
            {detection?.clis.map((cli) => (
              <tr key={cli.binary} className="border-b border-line last:border-0">
                <td className="px-3 py-1.5 font-mono">{cli.binary}</td>
                <td className="px-3 py-1.5">
                  <span className="flex items-center gap-1.5 whitespace-nowrap">
                    <StatusDot tone={cli.detected ? 'success' : 'neutral'} />
                    <span className="max-w-64 truncate">{cli.detected ? 'Installed' + (cli.version ? ' · ' + cli.version : '') : 'Not installed'}</span>
                  </span>
                </td>
                <td className={cn('px-3 py-1.5 text-fg-muted', TOOL_COLUMN.signIn)}>
                  <div className="max-w-56 truncate">{cli.detected ? (cli.auth?.checked ? (cli.auth.detail ?? (cli.auth.ok ? 'Signed in' : 'Not signed in')) : 'Verified when you connect') : '—'}</div>
                </td>
                <td className="w-full max-w-0 px-3 py-1.5 text-fg-muted"><div className="truncate">{cli.purpose}{!cli.executionSupported ? ' (not supported for model calls)' : ''}</div></td>
                <td className="px-3 py-1.5">{!cli.detected && ['claude', 'codex', 'gemini'].includes(cli.binary) ? <InstallActions id={cli.binary} /> : <span className="text-fg-subtle">—</span>}</td>
              </tr>
            ))}
            <tr>
              <td className="px-3 py-1.5 font-mono">ollama</td>
              <td className="px-3 py-1.5">
                <span className="flex items-center gap-1.5 whitespace-nowrap">
                  <StatusDot tone={detection?.ollama.reachable ? 'success' : 'neutral'} />
                  <span className="max-w-64 truncate">{detection
                    ? detection.ollama.reachable
                      ? 'Running at ' + detection.ollama.endpoint + ' · ' + (detection.ollama.models ?? 0) + ' models installed'
                      : 'Not reachable at ' + detection.ollama.endpoint
                    : 'Detecting…'}</span>
                </span>
              </td>
              <td className={cn('px-3 py-1.5 text-fg-subtle', TOOL_COLUMN.signIn)}>—</td>
              <td className="w-full max-w-0 px-3 py-1.5 text-fg-muted"><div className="truncate">Local model server, used through its HTTP endpoint</div></td>
              <td className="px-3 py-1.5">{detection && !detection.ollama.reachable && !detection.clis.find((c) => c.binary === 'ollama')?.detected ? <InstallActions id="ollama" /> : <span className="text-fg-subtle">—</span>}</td>
            </tr>
            <tr className="border-t border-line">
              <td className="px-3 py-1.5 font-mono">magpie</td>
              <td className="px-3 py-1.5">
                <span className="flex items-center gap-1.5 whitespace-nowrap">
                  <StatusDot tone={detection?.magpie?.reachable ? 'success' : 'neutral'} />
                  <span className="max-w-64 truncate">{detection
                    ? detection.magpie?.reachable
                      ? 'Gateway at ' + detection.magpie.endpoint + ' · ' + (detection.magpie.models ?? 0) + ' models and routing groups'
                      : 'Gateway not reachable' + (detection.magpie ? ' at ' + detection.magpie.endpoint : '')
                    : 'Detecting…'}</span>
                </span>
              </td>
              <td className={cn('px-3 py-1.5 text-fg-subtle', TOOL_COLUMN.signIn)}>—</td>
              <td className="w-full max-w-0 px-3 py-1.5 text-fg-muted"><div className="truncate">Magpie gateway — its models, routing groups and failover</div></td>
              <td className="px-3 py-1.5">{detection && !detection.magpie?.reachable ? <InstallActions id="magpie" /> : <span className="text-fg-subtle">—</span>}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
