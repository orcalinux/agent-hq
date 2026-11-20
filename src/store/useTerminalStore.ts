import { create } from 'zustand';
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { api, type TerminalInfo } from '@/api/client';

export interface TerminalRuntime {
  info: TerminalInfo;
  term: Terminal;
  fit: FitAddon;
  host: HTMLDivElement;
  source: EventSource | null;
  connected: boolean;
  dispose: () => void;
}

const runtimes = new Map<string, TerminalRuntime>();

export function getRuntime(id: string): TerminalRuntime | undefined {
  return runtimes.get(id);
}

const ANSI_DARK = {
  black: '#2a2a30', red: '#f0645c', green: '#4cc38a', yellow: '#e2b04a', blue: '#6aa3ff', magenta: '#c59af2', cyan: '#7dc4c4', white: '#d4d6da',
  brightBlack: '#5c5c66', brightRed: '#ff8a83', brightGreen: '#7ee0ad', brightYellow: '#f2c96d', brightBlue: '#8fbaff', brightMagenta: '#d9b8f8', brightCyan: '#9fdcdc', brightWhite: '#ffffff',
};
const ANSI_LIGHT = {
  black: '#18181b', red: '#c43a31', green: '#1a7f4e', yellow: '#a16207', blue: '#2563eb', magenta: '#8250df', cyan: '#0e7490', white: '#d0d0d8',
  brightBlack: '#6b6b76', brightRed: '#d9534a', brightGreen: '#23a064', brightYellow: '#b7791f', brightBlue: '#3b82f6', brightMagenta: '#9d6cf0', brightCyan: '#0891b2', brightWhite: '#f6f6f8',
};

export function terminalTheme(): ITheme {
  const root = document.documentElement;
  const css = getComputedStyle(root);
  const read = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const light = root.getAttribute('data-theme') === 'light';
  return {
    background: read('--canvas', light ? '#f6f6f8' : '#131316'),
    foreground: read('--fg', light ? '#18181b' : '#ececef'),
    cursor: read('--accent', '#6aa3ff'),
    cursorAccent: read('--canvas', '#131316'),
    selectionBackground: light ? 'rgba(37, 99, 235, 0.22)' : 'rgba(106, 163, 255, 0.28)',
    ...(light ? ANSI_LIGHT : ANSI_DARK),
  };
}

function applyThemeToAll() {
  const theme = terminalTheme();
  for (const runtime of runtimes.values()) runtime.term.options.theme = theme;
}

if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
  new MutationObserver(applyThemeToAll).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

function createRuntime(info: TerminalInfo): TerminalRuntime {
  const term = new Terminal({
    fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 12.5,
    lineHeight: 1.25,
    cursorBlink: true,
    cursorStyle: 'bar',
    scrollback: 5000,
    allowProposedApi: true,
    macOptionIsMeta: true,
    theme: terminalTheme(),
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon((_event, uri) => window.open(uri, '_blank', 'noopener,noreferrer')));
  const host = document.createElement('div');
  host.className = 'agent-hq-terminal h-full w-full';

  let pending = '';
  let sending = false;
  const flush = async () => {
    if (sending) return;
    sending = true;
    while (pending) {
      const data = pending;
      pending = '';
      try {
        await api.terminalInput(info.id, data);
      } catch (e) {
        pending = '';
        break;
      }
    }
    sending = false;
  };
  let replaying = false;
  term.onData((data) => {
    if (replaying) return;
    pending += data;
    void flush();
  });

  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  term.onResize(({ cols, rows }) => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => void api.terminalResize(info.id, cols, rows).catch(() => undefined), 60);
  });

  term.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') return true;
    replaying = false;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.shiftKey && event.code === 'KeyC') {
      const selection = term.getSelection();
      if (selection) void navigator.clipboard?.writeText(selection).catch(() => undefined);
      return false;
    }
    if (mod && event.shiftKey && event.code === 'KeyV') {
      return false;
    }
    return true;
  });

  const runtime: TerminalRuntime = { info, term, fit, host, source: null, connected: false, dispose: () => undefined };

  let opened = false;
  const connect = () => {
    const source = new EventSource(api.terminalStreamUrl(info.id));
    runtime.source = source;
    source.addEventListener('open', () => {
      if (opened) term.reset();
      opened = true;
      runtime.connected = true;
      useTerminalStore.getState().touch();
    });
    source.addEventListener('replay', (event) => {
      replaying = true;
      term.write(JSON.parse((event as MessageEvent).data) as string, () => {
        replaying = false;
      });
    });
    source.addEventListener('data', (event) => {
      term.write(JSON.parse((event as MessageEvent).data) as string);
    });
    source.addEventListener('exit', (event) => {
      const code = Number((event as MessageEvent).data.replace(/"/g, ''));
      useTerminalStore.getState().markExited(info.id, Number.isFinite(code) ? code : null);
    });
    source.addEventListener('closed', () => source.close());
    source.addEventListener('error', () => {
      runtime.connected = false;
      if (source.readyState === EventSource.CLOSED) useTerminalStore.getState().markExited(info.id, null);
      useTerminalStore.getState().touch();
    });
  };
  connect();

  runtime.dispose = () => {
    clearTimeout(resizeTimer);
    runtime.source?.close();
    term.dispose();
    host.remove();
  };
  return runtime;
}

interface TerminalState {
  sessions: TerminalInfo[];
  activeId: string | null;
  error: string | null;
  creating: boolean;
  version: number;
  touch: () => void;
  sync: () => Promise<void>;
  create: () => Promise<string | null>;
  close: (id: string) => Promise<void>;
  restart: (id: string) => Promise<void>;
  select: (id: string) => void;
  markExited: (id: string, code: number | null) => void;
}

function currentSize(): { cols: number; rows: number } {
  const active = [...runtimes.values()].find((runtime) => runtime.host.isConnected && runtime.host.offsetWidth > 0);
  return { cols: active?.term.cols ?? 100, rows: active?.term.rows ?? 14 };
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessions: [],
  activeId: null,
  error: null,
  creating: false,
  version: 0,
  touch: () => set((s) => ({ version: s.version + 1 })),
  sync: async () => {
    try {
      const { sessions } = await api.terminalSessions();
      for (const info of sessions) if (!runtimes.has(info.id)) runtimes.set(info.id, createRuntime(info));
      for (const id of [...runtimes.keys()]) {
        if (!sessions.some((info) => info.id === id)) {
          runtimes.get(id)?.dispose();
          runtimes.delete(id);
        }
      }
      set((s) => ({ sessions, error: null, activeId: sessions.some((i) => i.id === s.activeId) ? s.activeId : (sessions[0]?.id ?? null) }));
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },
  create: async () => {
    if (get().creating) return null;
    set({ creating: true, error: null });
    try {
      const size = currentSize();
      const { session } = await api.createTerminal(size.cols, size.rows);
      runtimes.set(session.id, createRuntime(session));
      set((s) => ({ sessions: [...s.sessions, session], activeId: session.id, creating: false }));
      return session.id;
    } catch (err) {
      set({ error: (err as Error).message, creating: false });
      return null;
    }
  },
  close: async (id) => {
    runtimes.get(id)?.dispose();
    runtimes.delete(id);
    try {
      await api.closeTerminal(id);
    } catch {
      /* already gone */
    }
    set((s) => {
      const sessions = s.sessions.filter((info) => info.id !== id);
      const index = s.sessions.findIndex((info) => info.id === id);
      const activeId = s.activeId === id ? (sessions[Math.min(index, sessions.length - 1)]?.id ?? null) : s.activeId;
      return { sessions, activeId };
    });
  },
  restart: async (id) => {
    await get().close(id);
    await get().create();
  },
  select: (id) => set({ activeId: id }),
  markExited: (id, code) =>
    set((s) => ({ sessions: s.sessions.map((info) => (info.id === id ? { ...info, exited: true, exitCode: code } : info)) })),
}));
