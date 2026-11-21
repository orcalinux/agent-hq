import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '@/api/client';
import type { Complexity } from '@/types';
import { COMPLEXITIES, COMPLEXITY_LABEL, routingFor } from '@/engine/modelRouting';
import { diffModels, snapshotModels, type KnownModels, type ModelChange } from '@/engine/modelWatch';
import { safeStorage } from './storage';
import { resolveAgentModel, useAgentStore } from './useAgentStore';
import { useConnectionsStore } from './useConnectionsStore';

export interface TierMove {
  at: number;
  tier: Complexity;
  from: string;
  to: string;
}

interface ModelWatchState {
  /** 0 turns automatic checks off. */
  intervalHours: number;
  lastCheckedAt: number | null;
  known: KnownModels;
  history: ModelChange[];
  tierMoves: TierMove[];
  checking: boolean;
  lastError: string | null;
  setIntervalHours: (hours: number) => void;
  check: () => Promise<{ changes: ModelChange[]; moves: TierMove[] }>;
}

export function currentRouting() {
  const agents = useAgentStore.getState();
  const conns = useConnectionsStore.getState();
  return routingFor(conns.providers, {
    scope: agents.modelScope,
    overrides: agents.tierModels,
    sovereignModel: resolveAgentModel(agents.agents['agent-manager'], agents.roleDefaults),
  });
}

function nameOf(ref: string): string {
  return useConnectionsStore.getState().providers.flatMap((p) => p.models).find((m) => m.ref === ref)?.name ?? ref;
}

export const useModelWatchStore = create<ModelWatchState>()(
  persist(
    (set, get) => ({
      intervalHours: 6,
      lastCheckedAt: null,
      known: {},
      history: [],
      tierMoves: [],
      checking: false,
      lastError: null,

      setIntervalHours: (hours) => set({ intervalHours: Math.max(0, hours) }),

      check: async () => {
        if (get().checking) return { changes: [], moves: [] };
        set({ checking: true, lastError: null });
        const before = useConnectionsStore.getState().loaded ? currentRouting().tiers : null;
        let failed: string | null = null;
        try {
          const { results } = await api.rescanModels();
          failed = results.filter((r) => !r.ok).map((r) => `${r.providerId}: ${r.error}`).join('; ') || null;
        } catch (err) {
          failed = (err as Error).message;
        }
        await useConnectionsStore.getState().load();
        const providers = useConnectionsStore.getState().providers;
        const now = Date.now();
        const current = snapshotModels(providers);
        const changes = diffModels(get().known, current, providers, now);
        const after = currentRouting().tiers;
        const moves: TierMove[] = before
          ? COMPLEXITIES.filter((t) => before[t] && after[t] && before[t] !== after[t]).map((tier) => ({ at: now, tier, from: before[tier], to: after[tier] }))
          : [];

        const log = useAgentStore.getState().logActivity;
        for (const c of changes) {
          if (c.added.length) log({ kind: 'info', level: 'info', text: `New ${c.provider} model${c.added.length === 1 ? '' : 's'}: ${c.added.map((m) => m.name).join(', ')}` });
          if (c.removed.length) log({ kind: 'info', level: 'warn', text: `${c.provider} no longer offers: ${c.removed.map((m) => m.name).join(', ')}` });
        }
        for (const m of moves) log({ kind: 'info', level: 'info', text: `${COMPLEXITY_LABEL[m.tier]} tasks now use ${nameOf(m.to)} (was ${nameOf(m.from)})`, model: m.to });
        const added = changes.flatMap((c) => c.added);
        if (added.length) (typeof window !== 'undefined' ? window.agentHqDesktop : undefined)?.notify('New models available', added.map((m) => m.name).join(', '));

        set((s) => ({
          known: { ...s.known, ...current },
          lastCheckedAt: now,
          history: [...changes, ...s.history].slice(0, 30),
          tierMoves: [...moves, ...s.tierMoves].slice(0, 30),
          checking: false,
          lastError: failed,
        }));
        return { changes, moves };
      },
    }),
    {
      name: 'agent-hq.model-watch',
      version: 1,
      storage: safeStorage,
      partialize: (s) => ({ intervalHours: s.intervalHours, lastCheckedAt: s.lastCheckedAt, known: s.known, history: s.history, tierMoves: s.tierMoves }),
    }
  )
);
