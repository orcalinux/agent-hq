import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, ChevronsUpDown, Folder, FolderGit2, FolderOpen, FolderPlus, Home, RefreshCw } from 'lucide-react';
import { api } from '@/api/client';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { useAgentStore } from '@/store/useAgentStore';
import { Dialog } from '@/components/ui/Dialog';
import { Badge, Button, Field, IconButton, Input, Spinner, Tabs, Textarea } from '@/components/ui/primitives';
import { cn } from '@/utils/cn';

type Listing = Awaited<ReturnType<typeof api.browse>>;

function useBrowser(initial: string) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hidden, setHidden] = useState(false);
  const go = useCallback(
    async (path?: string, showHidden = hidden) => {
      setLoading(true);
      try {
        setListing(await api.browse(path, showHidden));
        setError(null);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [hidden]
  );
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    void goRef.current(initial || undefined);
  }, [initial]);
  const toggleHidden = () => {
    setHidden(!hidden);
    void go(listing?.path, !hidden);
  };
  return { listing, error, loading, go, hidden, toggleHidden };
}

function FolderBrowser({ browser, selected, onSelect, onOpen }: { browser: ReturnType<typeof useBrowser>; selected: string | null; onSelect: (p: string) => void; onOpen?: (p: string) => void }) {
  const { listing, error, loading, go, hidden, toggleHidden } = browser;
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (listing) setTyped(listing.path);
  }, [listing]);
  const crumbs = listing ? listing.path.split('/').filter(Boolean) : [];
  return (
    <div className="rounded-md border border-line">
      <div className="flex items-center gap-1 border-b border-line p-1.5">
        <IconButton size="sm" icon={ArrowUp} label="Parent folder" disabled={!listing?.parent} onClick={() => void go(listing?.parent ?? undefined)} />
        <IconButton size="sm" icon={Home} label="Home folder" onClick={() => void go(listing?.home)} />
        <form
          className="min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            void go(typed);
          }}
        >
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Folder path" className="font-mono text-[12px]" />
        </form>
        <IconButton size="sm" icon={RefreshCw} label="Refresh" onClick={() => void go(listing?.path)} />
      </div>
      <div className="flex flex-wrap items-center gap-0.5 border-b border-line px-2 py-1 text-[11.5px] text-fg-muted">
        <button type="button" className="rounded px-1 hover:bg-surface-2 hover:text-fg" onClick={() => void go('/')}>/</button>
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center">
            <button type="button" className="rounded px-1 hover:bg-surface-2 hover:text-fg" onClick={() => void go('/' + crumbs.slice(0, i + 1).join('/'))}>{c}</button>
            {i < crumbs.length - 1 ? <span className="text-fg-subtle">/</span> : null}
          </span>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-fg-subtle">
          <input type="checkbox" checked={hidden} onChange={toggleHidden} className="accent-[var(--accent)]" />
          Hidden
        </label>
      </div>
      <ul role="listbox" aria-label="Folders" className="h-64 overflow-y-auto p-1">
        {loading && !listing ? <li className="flex justify-center p-4"><Spinner /></li> : null}
        {error ? <li className="p-2 text-[12px] text-danger">{error}</li> : null}
        {listing && listing.dirs.length === 0 && !error ? <li className="p-2 text-[12px] text-fg-subtle">No sub-folders here.</li> : null}
        {listing?.dirs.map((d) => (
          <li key={d.path} role="option" aria-selected={selected === d.path}>
            <button
              type="button"
              onClick={() => onSelect(d.path)}
              onDoubleClick={() => (onOpen ? onOpen(d.path) : void go(d.path))}
              className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12.5px]', selected === d.path ? 'bg-accent-soft text-fg' : 'text-fg-muted hover:bg-surface-2 hover:text-fg')}
            >
              {d.isProject ? <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-accent" /> : <Folder className="h-3.5 w-3.5 shrink-0" />}
              <span className="min-w-0 flex-1 truncate">{d.name}</span>
              {d.isProject ? <Badge tone="accent">project</Badge> : null}
              <span
                role="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  void go(d.path);
                }}
                className="rounded px-1.5 text-[11px] text-fg-subtle hover:bg-surface-3 hover:text-fg"
              >
                Enter ›
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const root = useWorkspaceStore((s) => s.root);
  const recent = useWorkspaceStore((s) => s.recent);
  const locked = useWorkspaceStore((s) => s.lockedByEnv);
  const setRoot = useWorkspaceStore((s) => s.setRoot);
  const createProject = useWorkspaceStore((s) => s.createProject);
  const running = useAgentStore((s) => s.activeMission?.status === 'running');
  const [tab, setTab] = useState<'open' | 'new'>('open');
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [gitInit, setGitInit] = useState(true);
  const parentDir = root ? root.replace(/\/[^/]+\/?$/, '') || '/' : '';
  const browser = useBrowser(parentDir);

  const blocked = locked ? 'The project folder is fixed by the AGENT_HQ_WORKSPACE environment variable.' : running ? 'Stop the current run before switching projects.' : null;

  const openFolder = async (path: string) => {
    setBusy(true);
    setError(null);
    try {
      await setRoot(path);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await createProject({ parent: browser.listing?.path ?? '', name: name.trim(), gitInit, description });
      setName('');
      setDescription('');
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const target = selected ?? browser.listing?.path ?? '';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Project"
      description="Agents read, write and run commands only inside the project folder."
      width="max-w-2xl"
      footer={
        <div className="flex w-full items-center gap-2">
          {error ? <span className="min-w-0 flex-1 truncate text-[12px] text-danger" title={error}>{error}</span> : blocked ? <span className="min-w-0 flex-1 truncate text-[12px] text-warning">{blocked}</span> : <span className="flex-1" />}
          <Button onClick={onClose}>Cancel</Button>
          {tab === 'open' ? (
            <Button variant="primary" icon={FolderOpen} loading={busy} disabled={!target || Boolean(blocked) || target === root} onClick={() => void openFolder(target)}>
              Open {target ? '“' + target.split('/').filter(Boolean).pop() + '”' : ''}
            </Button>
          ) : (
            <Button variant="primary" icon={FolderPlus} loading={busy} disabled={!name.trim() || !browser.listing || Boolean(blocked)} onClick={() => void create()}>
              Create project
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Tabs<'open' | 'new'> label="Project action" value={tab} onChange={setTab} items={[{ id: 'open', label: 'Open folder' }, { id: 'new', label: 'New project' }]} />
          <span className="min-w-0 truncate font-mono text-[11.5px] text-fg-subtle" title={root}>Current: {root || 'none'}</span>
        </div>

        {tab === 'open' ? (
          <>
            {recent.filter((r) => r !== root).length ? (
              <section>
                <h3 className="mb-1 text-[11.5px] font-medium uppercase tracking-wide text-fg-subtle">Recent</h3>
                <ul className="grid gap-1 sm:grid-cols-2">
                  {recent
                    .filter((r) => r !== root)
                    .map((r) => (
                      <li key={r}>
                        <button
                          type="button"
                          disabled={Boolean(blocked) || busy}
                          onClick={() => void openFolder(r)}
                          className="flex w-full items-center gap-2 rounded-md border border-line px-2 py-1.5 text-left hover:bg-surface-2 disabled:opacity-50"
                        >
                          <FolderGit2 className="h-4 w-4 shrink-0 text-accent" />
                          <span className="min-w-0">
                            <span className="block truncate text-[12.5px] font-medium">{r.split('/').filter(Boolean).pop()}</span>
                            <span className="block truncate font-mono text-[11px] text-fg-subtle">{r}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                </ul>
              </section>
            ) : null}
            <section>
              <h3 className="mb-1 text-[11.5px] font-medium uppercase tracking-wide text-fg-subtle">Browse</h3>
              <FolderBrowser browser={browser} selected={selected} onSelect={setSelected} onOpen={(p) => void openFolder(p)} />
              <p className="mt-1 text-[11.5px] text-fg-subtle">Click to select, double-click to open. “Enter ›” goes into a folder. With nothing selected, the folder you are in is opened.</p>
            </section>
          </>
        ) : (
          <>
            <Field label="Project name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-new-app" autoFocus />
            </Field>
            <Field label="What is it? (optional)" hint="Saved as README.md so Sovereign and the agents have context from the start.">
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="A web app that…" className="min-h-20 resize-y" />
            </Field>
            <label className="flex items-center gap-2 text-[12.5px]">
              <input type="checkbox" checked={gitInit} onChange={(e) => setGitInit(e.target.checked)} className="accent-[var(--accent)]" />
              Initialize a git repository (lets you review and undo agent changes)
            </label>
            <section>
              <h3 className="mb-1 text-[11.5px] font-medium uppercase tracking-wide text-fg-subtle">Location</h3>
              <FolderBrowser browser={browser} selected={null} onSelect={(p) => void browser.go(p)} />
              <p className="mt-1 font-mono text-[11.5px] text-fg-muted">
                Will create: {(browser.listing?.path ?? '…') + '/' + (name.trim() || '<name>')}
              </p>
            </section>
          </>
        )}
      </div>
    </Dialog>
  );
}

export function ProjectSwitcher({ collapsed }: { collapsed: boolean }) {
  const [open, setOpen] = useState(false);
  const name = useWorkspaceStore((s) => s.name);
  const root = useWorkspaceStore((s) => s.root);
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('agent-hq:open-project', onOpen);
    return () => {
      window.removeEventListener('agent-hq:open-project', onOpen);
    };
  }, []);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={root ? 'Project: ' + root + ' (click to switch)' : 'Choose a project'}
        className={cn('flex w-full items-center gap-2 rounded-md border border-line bg-surface-2 px-2 py-1.5 text-left hover:border-line-strong hover:bg-surface-3', collapsed && 'justify-center border-transparent bg-transparent px-0')}
      >
        <FolderGit2 className="h-4 w-4 shrink-0 text-accent" />
        {collapsed ? (
          <span className="sr-only">Switch project</span>
        ) : (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium">{name || 'No project'}</span>
              <span className="block truncate font-mono text-[10.5px] text-fg-subtle">{root ? root.replace(/^\/home\/[^/]+/, '~') : 'Choose a folder'}</span>
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
          </>
        )}
      </button>
      {open ? <ProjectDialog open onClose={() => setOpen(false)} /> : null}
    </>
  );
}
