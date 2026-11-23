import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api, type MagpieBalance, type MagpieQuota } from '@/api/client';
import type { AIModelId, Complexity } from '@/types';
import { MAGPIE_GROUP, magpieGroupsFor, quotaKeyOf, rankModels } from '@/engine/modelRouting';
import { safeStorage } from './storage';
import { useConnectionsStore } from './useConnectionsStore';
import { currentRouting, useModelWatchStore } from './useModelWatchStore';

export const BALANCES: Array<{ id: MagpieBalance; label: string; hint: string }> = [
  { id: 'usage', label: 'Quota left', hint: 'The subscription with the most of its allowance left serves first.' },
  { id: 'pace', label: 'Weekly pace', hint: 'Spreads use so the least of each weekly allowance is lost at its reset.' },
  { id: 'rotate', label: 'Take turns', hint: 'Each conversation goes to the next model in turn.' },
  { id: 'weight', label: 'By score', hint: "Stronger models take a bigger share, by Agent HQ's score." },
];

/** Below this percent left in any window, a subscription is avoided while a peer has room. */
export const LOW_QUOTA_PERCENT = 10;
/** A reading newer than this is reused; anything older is fetched again. */
export const QUOTA_TTL_MS = 10_000;
export const QUOTA_POLL_MS = 15_000;
/** Magpie readings older than this are flagged as stale. */
export const QUOTA_STALE_MS = 10 * 60_000;
let quotaRequest: Promise<void> | null = null;
let quotaQueued: Promise<void> | null = null;

export interface SyncedGroup {
  ref: AIModelId;
  models: string[];
}

interface MagpieState {
  /** Let Magpie pick the account for Auto levels, through groups Agent HQ keeps up to date. */
  enabled: boolean;
  balance: MagpieBalance;
  synced: Partial<Record<Complexity, SyncedGroup>>;
  signature: string;
  syncedAt: number | null;
  syncing: boolean;
  syncError: string | null;
  quotas: MagpieQuota[];
  quotasAt: number | null;
  quotaError: string | null;
  setEnabled: (on: boolean) => Promise<void>;
  setBalance: (balance: MagpieBalance) => Promise<void>;
  sync: (force?: boolean) => Promise<void>;
  loadQuotas: (force?: boolean) => Promise<void>;
}

function plannedGroups() {
  const { models, peers } = currentRouting();
  return magpieGroupsFor(rankModels(models, useModelWatchStore.getState().results), peers);
}

function magpieConnected(): boolean {
  return Boolean(useConnectionsStore.getState().providers.find((p) => p.id === 'magpie')?.connection);
}

export const useMagpieStore = create<MagpieState>()(
  persist(
    (set, get) => ({
      enabled: false,
      balance: 'usage',
      synced: {},
      signature: '',
      syncedAt: null,
      syncing: false,
      syncError: null,
      quotas: [],
      quotasAt: null,
      quotaError: null,

      setEnabled: async (on) => {
        set({ enabled: on, syncError: null });
        if (on) {
          await get().sync(true);
          void get().loadQuotas(true);
          return;
        }
        set({ synced: {}, signature: '', syncedAt: null });
        try {
          await api.removeMagpieGroups();
          await useConnectionsStore.getState().load();
        } catch (err) {
          set({ syncError: (err as Error).message });
        }
      },

      setBalance: async (balance) => {
        set({ balance });
        if (get().enabled) await get().sync(true);
      },

      sync: async (force = false) => {
        if (!get().enabled || get().syncing) return;
        if (!magpieConnected()) {
          set({ syncError: 'Connect the Magpie gateway in Connections first.' });
          return;
        }
        const groups = plannedGroups();
        const balance = get().balance;
        const signature = JSON.stringify({ balance, groups });
        if (!force && signature === get().signature) return;
        if (!groups.length) {
          set({ synced: {}, signature, syncError: 'None of the models Agent HQ would use are offered through Magpie.' });
          return;
        }
        set({ syncing: true, syncError: null });
        try {
          const { results } = await api.syncMagpieGroups(groups.map((g) => ({ id: g.id, models: g.models, routing: balance, ...(balance === 'weight' ? { weights: g.weights } : {}) })));
          const ok = new Set(results.filter((r) => r.ok).map((r) => r.id));
          const failed = results.filter((r) => !r.ok).map((r) => `${r.id}: ${r.error}`);
          const synced: Partial<Record<Complexity, SyncedGroup>> = {};
          for (const g of groups) if (ok.has(g.id)) synced[g.tier] = { ref: `magpie:group/${MAGPIE_GROUP[g.tier]}`, models: g.models };
          await useConnectionsStore.getState().refresh('magpie').catch(() => undefined);
          set({ synced, signature, syncedAt: Date.now(), syncing: false, syncError: failed.length ? failed.join('; ') : null });
        } catch (err) {
          set({ syncing: false, syncError: (err as Error).message });
        }
      },

      loadQuotas: (force = false) => {
        const at = get().quotasAt;
        if (!force && at && Date.now() - at < QUOTA_TTL_MS) return Promise.resolve();
        const fetchQuotas = () => {
          quotaRequest = (async () => {
            try {
              const r = await api.magpieQuotas();
              if (r.ok) set({ quotas: r.quotas, quotasAt: Date.now(), quotaError: null });
              else set({ quotaError: r.error ?? 'Could not read quotas.', ...(get().quotas.length ? {} : { quotasAt: Date.now() }) });
            } catch (err) {
              set({ quotaError: (err as Error).message });
            } finally {
              quotaRequest = null;
            }
          })();
          return quotaRequest;
        };
        if (!quotaRequest) return fetchQuotas();
        if (!force) return quotaRequest;
        // A forced read must not reuse an answer that was already on its way before the call.
        quotaQueued ??= quotaRequest.then(() => {
          quotaQueued = null;
          return fetchQuotas();
        });
        return quotaQueued;
      },
    }),
    {
      name: 'agent-hq.magpie-routing',
      version: 1,
      storage: safeStorage,
      partialize: (s) => ({ enabled: s.enabled, balance: s.balance, synced: s.synced, signature: s.signature, syncedAt: s.syncedAt }),
    }
  )
);

/** Lowest percent left across a subscription's windows, if Magpie reports it. */
export function quotaLeft(quotas: MagpieQuota[], ref: AIModelId): number | undefined {
  const key = quotaKeyOf(ref);
  const q = key ? quotas.find((x) => x.provider === key) : undefined;
  return q?.windows.length ? Math.min(...q.windows.map((w) => w.remaining)) : undefined;
}

export function isLowQuota(ref: AIModelId): boolean {
  const left = quotaLeft(useMagpieStore.getState().quotas, ref);
  return left !== undefined && left < LOW_QUOTA_PERCENT;
}

/** Groups standing in for Auto levels, only while Magpie routing is on and the group exists in Magpie. */
export function activeMagpieGroups(): Partial<Record<Complexity, AIModelId>> {
  const s = useMagpieStore.getState();
  if (!s.enabled) return {};
  const offered = new Set(useConnectionsStore.getState().providers.find((p) => p.id === 'magpie' && p.connection)?.models.map((m) => m.ref) ?? []);
  const out: Partial<Record<Complexity, AIModelId>> = {};
  for (const [tier, g] of Object.entries(s.synced) as Array<[Complexity, SyncedGroup]>) if (offered.has(g.ref)) out[tier] = g.ref;
  return out;
}

useModelWatchStore.subscribe((s, prev) => {
  if (s.lastCheckedAt !== prev.lastCheckedAt || s.results !== prev.results) void useMagpieStore.getState().sync();
});
