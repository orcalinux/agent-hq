import { createJSONStorage, type StateStorage } from 'zustand/middleware';

const memory = new Map<string, string>();
const memoryStorage: StateStorage = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => void memory.set(k, v),
  removeItem: (k) => void memory.delete(k),
};

export const safeStorage = createJSONStorage(() => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    // storage blocked
  }
  return memoryStorage;
});
