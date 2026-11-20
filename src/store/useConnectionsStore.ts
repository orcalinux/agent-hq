import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api, type ConnectPayload, type DetectResponse, type TestResult } from '@/api/client';
import type { AIModelId, AIProviderId, ModelInfo, ModelPricing, ProviderState } from '@/types';
import { safeStorage } from './storage';
import { canonicalizeAgentModels } from './useAgentStore';

interface ConnectionsState {
  providers: ProviderState[];
  detection: DetectResponse | null;
  loading: boolean;
  detecting: boolean;
  loaded: boolean;
  error: string | null;
  refreshing: Partial<Record<AIProviderId, boolean>>;
  /** Providers whose credit or rate limit ran out during this session, mapped to the time they may be retried. */
  exhausted: Record<string, number>;
  /** User-entered pricing per model ref (USD per 1M tokens). */
  userPricing: Record<AIModelId, { inputPerM: number; outputPerM: number }>;

  load: () => Promise<void>;
  detect: () => Promise<void>;
  test: (payload: ConnectPayload) => Promise<TestResult>;
  connect: (payload: ConnectPayload) => Promise<TestResult>;
  disconnect: (providerId: AIProviderId) => Promise<void>;
  refresh: (providerId: AIProviderId) => Promise<TestResult>;
  setUserPricing: (ref: AIModelId, pricing: { inputPerM: number; outputPerM: number } | null) => void;
  markExhausted: (providerId: string, until: number) => void;
  clearExhausted: (providerId?: string) => void;
}

export const useConnectionsStore = create<ConnectionsState>()(
  persist(
    (set, get) => ({
      providers: [],
      detection: null,
      loading: false,
      detecting: false,
      loaded: false,
      error: null,
      refreshing: {},
      exhausted: {},
      userPricing: {},

      load: async () => {
        set({ loading: true, error: null });
        try {
          const data = await api.connections();
          set({ providers: data.providers, loading: false, loaded: true });
          canonicalizeAgentModels(data.providers.flatMap((provider) => provider.models));
        } catch (err) {
          set({ loading: false, loaded: true, error: (err as Error).message });
        }
      },

      detect: async () => {
        set({ detecting: true });
        try {
          const detection = await api.detect();
          set({ detection, detecting: false });
        } catch (err) {
          set({ detecting: false, error: (err as Error).message });
        }
      },

      test: async (payload) => {
        try {
          return await api.testConnection(payload);
        } catch (err) {
          return { ok: false, error: (err as Error).message };
        }
      },

      connect: async (payload) => {
        try {
          const result = await api.connect(payload);
          if (result.ok) await get().load();
          return result;
        } catch (err) {
          return { ok: false, error: (err as Error).message };
        }
      },

      disconnect: async (providerId) => {
        await api.disconnect(providerId);
        await get().load();
      },

      refresh: async (providerId) => {
        set((s) => ({ refreshing: { ...s.refreshing, [providerId]: true } }));
        try {
          const result = await api.refresh(providerId);
          await get().load();
          return result;
        } catch (err) {
          return { ok: false, error: (err as Error).message };
        } finally {
          set((s) => ({ refreshing: { ...s.refreshing, [providerId]: false } }));
        }
      },

      setUserPricing: (ref, pricing) =>
        set((s) => {
          const next = { ...s.userPricing };
          if (pricing) next[ref] = pricing;
          else delete next[ref];
          return { userPricing: next };
        }),

      markExhausted: (providerId, until) => set((s) => ({ exhausted: { ...s.exhausted, [providerId]: until } })),

      clearExhausted: (providerId) =>
        set((s) => {
          if (!providerId) return { exhausted: {} };
          const next = { ...s.exhausted };
          delete next[providerId];
          return { exhausted: next };
        }),
    }),
    {
      name: 'agent-hq.connections',
      storage: safeStorage,
      partialize: (s) => ({ userPricing: s.userPricing }),
    }
  )
);

export function selectAllModels(providers: ProviderState[]): ModelInfo[] {
  return providers.flatMap((p) => (p.connection ? p.models.filter((model) => model.selectable !== false) : []));
}

export function findModel(providers: ProviderState[], ref: AIModelId | undefined): ModelInfo | undefined {
  if (!ref) return undefined;
  for (const p of providers) {
    const m = p.models.find((x) => x.ref === ref);
    if (m) return m;
  }
  return undefined;
}

export function pricingFor(
  providers: ProviderState[],
  userPricing: ConnectionsState['userPricing'],
  ref: AIModelId | undefined
): ModelPricing | undefined {
  if (!ref) return undefined;
  const model = findModel(providers, ref);
  if (model?.pricing) return model.pricing;
  const user = userPricing[ref];
  return user ? { ...user, source: 'user' } : undefined;
}

/** True when the model's provider is connected and the model was discovered. */
export function isModelAvailable(providers: ProviderState[], ref: AIModelId | undefined): boolean {
  if (!ref) return false;
  return providers.some((p) => p.connection && p.models.some((m) => m.ref === ref && (m.selectable !== false || Boolean(m.canonicalRef))));
}
