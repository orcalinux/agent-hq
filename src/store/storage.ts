import { createJSONStorage, type StateStorage } from 'zustand/middleware';

const memory = new Map<string, string>();
const memoryStorage: StateStorage = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => void memory.set(k, v),
  removeItem: (k) => void memory.delete(k),
};

export const safeStorage = createJSONStorage(() => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const local = window.localStorage;
      const desktop = window.agentHqDesktop?.stateStorage;
      if (!desktop) return local;
      return {
        getItem: (key: string) => {
          const saved = desktop.read(key);
          const value = saved.restore ? saved.value : local.getItem(key);
          if (saved.restore) {
            if (value === null) local.removeItem(key);
            else local.setItem(key, value);
          }
          desktop.write(key, value);
          return value;
        },
        setItem: (key: string, value: string) => {
          local.setItem(key, value);
          desktop.write(key, value);
        },
        removeItem: (key: string) => {
          local.removeItem(key);
          desktop.write(key, null);
        },
      } satisfies StateStorage;
    }
  } catch {
    // storage blocked
  }
  return memoryStorage;
});
