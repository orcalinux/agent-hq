import { create } from 'zustand';
import { desktopApi } from './bridge';
import { DEFAULT_UPDATE_PREFS, type UpdatePrefs, type UpdateState } from './types';

export { fmtSize, updateButtonState } from './updateView';

export const RELEASES_URL = 'https://github.com/orcalinux/agent-hq/releases';
const HIDE_FOR_MS = 3 * 24 * 60 * 60 * 1000;

/** confirm: before a restart into a downloaded update. after: first launch after one. browse: from Settings. */
export type NotesMode = 'confirm' | 'after' | 'browse';

interface UpdateStore {
  state: UpdateState | null;
  prefs: UpdatePrefs;
  notes: NotesMode | null;
  centerOpen: boolean;
  settingsRequested: boolean;
  closeCenter: () => void;
  /** The title bar button asked for the download, so it shows progress and asks to restart when done. */
  pulling: boolean;
  openNotes: (mode: NotesMode) => void;
  closeNotes: () => void;
  setPrefs: (next: Partial<UpdatePrefs>) => Promise<void>;
  check: () => void;
  download: (fromButton?: boolean) => void;
  install: (when: 'now' | 'idle') => void;
  /** The × on the title bar button: hidden for 3 days, unless a newer version comes out. */
  hideButton: () => void;
}

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  state: null,
  prefs: DEFAULT_UPDATE_PREFS,
  notes: null,
  centerOpen: false,
  settingsRequested: false,
  closeCenter: () => set({ centerOpen: false }),
  pulling: false,
  openNotes: (mode) => set({ notes: mode, centerOpen: false }),
  closeNotes: () => {
    if (get().notes === 'after') desktopApi()?.ackUpdated();
    set({ notes: null });
  },
  setPrefs: async (next) => {
    const api = desktopApi();
    set((s) => ({ prefs: { ...s.prefs, ...next } }));
    if (api) set({ prefs: await api.setUpdatePrefs(next) });
  },
  check: () => {
    if (get().notes) get().closeNotes();
    set({ centerOpen: true });
    desktopApi()?.checkForUpdates();
  },
  download: (fromButton = false) => {
    if (fromButton) set({ pulling: true });
    desktopApi()?.downloadUpdate();
  },
  install: (when) => {
    if (when === 'idle') set({ notes: null });
    desktopApi()?.installUpdate(when);
  },
  hideButton: () => {
    const version = get().state?.version;
    void get().setPrefs({ hiddenUntil: Date.now() + HIDE_FOR_MS, hiddenVersion: version });
  },
}));

/** Mirrors the desktop updater into the UI. No-op in a browser. */
export function installUpdateBridge(): () => void {
  const api = desktopApi();
  if (!api?.onUpdate) return () => {};
  const apply = (state: UpdateState) => {
    const store = useUpdateStore.getState();
    const patch: Partial<UpdateStore> = { state };
    if (store.pulling && state.status === 'ready') {
      patch.pulling = false;
      if (!store.notes) {
        patch.notes = 'confirm';
        patch.centerOpen = false;
      }
    } else if (store.pulling && (state.status === 'error' || state.status === 'up-to-date')) patch.pulling = false;
    if (store.notes === 'confirm' && state.status !== 'ready') patch.notes = null;
    useUpdateStore.setState(patch);
  };
  const off = api.onUpdate(apply);
  void api.getUpdatePrefs().then((prefs) => prefs && useUpdateStore.setState({ prefs }));
  void api.getUpdateState().then((state) => {
    if (!state) return;
    if (!useUpdateStore.getState().state) apply(state);
    if (state.updatedFrom && !useUpdateStore.getState().notes) useUpdateStore.setState({ notes: 'after' });
  });
  return off;
}
