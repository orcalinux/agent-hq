import { useMemo } from 'react';
import { useConnectionsStore } from '@/store/useConnectionsStore';
import type { AgentStatus, AgentTokenUsage, AIModelId, ProviderState } from '@/types';
import { shortModelLabel } from '@/types';
import { Select } from './primitives';

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export function statusTone(status: AgentStatus): Tone {
  switch (status) {
    case 'thinking':
    case 'coding':
    case 'reviewing':
    case 'debating':
      return 'accent';
    case 'approved':
    case 'graduated':
      return 'success';
    case 'waiting':
      return 'warning';
    case 'rejected':
    case 'error':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function isBusy(status: AgentStatus): boolean {
  return status === 'thinking' || status === 'coding' || status === 'reviewing' || status === 'debating';
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

export function fmtDuration(ms: number): string {
  if (!ms || ms < 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

export function fmtCost(cost: number): string {
  if (cost === 0) return '$0.00';
  return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
}

/** Cost label that is honest about unpriced usage. */
export function usageCostLabel(usage: Pick<AgentTokenUsage, 'estimatedCostUSD' | 'unpricedTokens' | 'calls' | 'totalTokens'>): string {
  if (usage.calls === 0) return '—';
  if (usage.unpricedTokens > 0 && usage.estimatedCostUSD === 0) return 'unpriced';
  return usage.unpricedTokens > 0 ? `${fmtCost(usage.estimatedCostUSD)}+` : fmtCost(usage.estimatedCostUSD);
}

export function fmtRelative(ts: number | undefined): string {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 45_000) return 'just now';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export function fmtDateTime(ts: number | string | undefined): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function providerName(providers: ProviderState[], ref: AIModelId): string {
  const id = ref.split(':')[0];
  return providers.find((p) => p.id === id)?.name ?? (id || '—');
}

export function modelLabel(providers: ProviderState[], ref: AIModelId): string {
  for (const p of providers) {
    const m = p.models.find((x) => x.ref === ref);
    if (m) return m.name;
  }
  return shortModelLabel(ref);
}

interface ModelSelectProps {
  value: AIModelId;
  onChange: (ref: AIModelId) => void;
  emptyLabel?: string;
  className?: string;
  disabled?: boolean;
  'aria-label'?: string;
}

/** Select of discovered models from connected providers, grouped by provider. */
export function ModelSelect({ value, onChange, emptyLabel = 'Unassigned', className, disabled, ...rest }: ModelSelectProps) {
  const providers = useConnectionsStore((s) => s.providers);
  const groups = useMemo(
    () => providers.filter((p) => p.connection && p.models.length > 0),
    [providers]
  );
  const known = groups.some((g) => g.models.some((m) => m.ref === value));
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className={className} disabled={disabled} aria-label={rest['aria-label'] ?? 'Model'}>
      <option value="">{emptyLabel}</option>
      {groups.length === 0 ? (
        <option value="__none" disabled>
          No models yet. Connect a provider in Connections.
        </option>
      ) : null}
      {value && !known ? <option value={value}>{shortModelLabel(value)} (not connected)</option> : null}
      {groups.map((p) => (
        <optgroup key={p.id} label={p.name}>
          {p.models.map((m) => (
            <option key={m.ref} value={m.ref}>
              {m.name}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}
