import type { UpdatePrefs, UpdateState } from './types';

/** Whether the title bar shows its Update button, and what it says. */
export function updateButtonState(state: UpdateState | null, prefs: UpdatePrefs, pulling: boolean, now = Date.now()) {
  if (!state || !prefs.showButton) return null;
  const hidden = !pulling && Boolean(prefs.hiddenUntil && prefs.hiddenUntil > now && (!state.version || state.version === prefs.hiddenVersion));
  if (hidden) return null;
  if (state.status === 'ready') return state.waiting ? ('waiting' as const) : ('ready' as const);
  if (state.status === 'available') return 'available' as const;
  if (state.status === 'error' && state.version) return 'failed' as const;
  if (pulling && (state.status === 'downloading' || state.status === 'checking')) return 'downloading' as const;
  return null;
}

export function fmtSize(bytes?: number): string {
  if (!bytes) return '';
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}
