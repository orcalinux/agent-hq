import type { AIProviderId, ProviderState } from '@/types';

export interface KnownModel {
  ref: string;
  name: string;
}

export interface ModelChange {
  at: number;
  providerId: AIProviderId;
  provider: string;
  added: KnownModel[];
  removed: KnownModel[];
}

export type KnownModels = Partial<Record<AIProviderId, KnownModel[]>>;

/** Models a connected provider offers now, without the aliases that only point at another model. */
export function snapshotModels(providers: ProviderState[]): KnownModels {
  const out: KnownModels = {};
  for (const p of providers) {
    if (!p.connection) continue;
    out[p.id] = p.models.filter((m) => m.selectable !== false).map((m) => ({ ref: m.ref, name: m.name }));
  }
  return out;
}

/**
 * What changed since the last check, per provider. A provider seen for the first time only sets
 * the baseline, so connecting a provider does not announce every model it has as new.
 */
export function diffModels(previous: KnownModels, current: KnownModels, providers: ProviderState[], now = Date.now()): ModelChange[] {
  const changes: ModelChange[] = [];
  for (const [id, models] of Object.entries(current) as Array<[AIProviderId, KnownModel[]]>) {
    const before = previous[id];
    if (!before) continue;
    const had = new Set(before.map((m) => m.ref));
    const has = new Set(models.map((m) => m.ref));
    const added = models.filter((m) => !had.has(m.ref));
    const removed = before.filter((m) => !has.has(m.ref));
    if (added.length || removed.length) {
      changes.push({ at: now, providerId: id, provider: providers.find((p) => p.id === id)?.name ?? id, added, removed });
    }
  }
  return changes;
}

export const CHECK_INTERVALS: Array<{ hours: number; label: string }> = [
  { hours: 1, label: 'Every hour' },
  { hours: 6, label: 'Every 6 hours' },
  { hours: 24, label: 'Daily' },
  { hours: 0, label: 'Off' },
];

export function isCheckDue(lastCheckedAt: number | null, hours: number, now = Date.now()): boolean {
  if (hours <= 0) return false;
  return lastCheckedAt === null || now - lastCheckedAt >= hours * 3_600_000;
}
