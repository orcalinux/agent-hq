import type { ViewMode } from '../src/types';

export const PROTOCOL = 'agenthq';

const VIEWS: ViewMode[] = ['workspace', 'agents', 'tasks', 'reports', 'connections', 'settings'];

export type DeepLink = { type: 'navigate'; view: ViewMode } | { type: 'open-project'; path: string };

/**
 * agenthq://open?path=/abs/project   open a project folder (the app asks first)
 * agenthq://view/agents              show a view
 */
export function parseDeepLink(raw: string): DeepLink | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== `${PROTOCOL}:`) return null;
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);
  if (host === 'open') {
    const target = url.searchParams.get('path');
    if (!target || target.includes('\0')) return null;
    const isAbsolute = target.startsWith('/') || /^[A-Za-z]:[\\/]/.test(target);
    return isAbsolute ? { type: 'open-project', path: target } : null;
  }
  if (host === 'view') {
    const view = segments[0]?.toLowerCase() as ViewMode | undefined;
    return view && VIEWS.includes(view) ? { type: 'navigate', view } : null;
  }
  return null;
}

export function deepLinkFromArgv(argv: string[]): string | undefined {
  return argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));
}
