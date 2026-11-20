import { useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, File, Folder, FolderOpen, RefreshCw, Search, Upload } from 'lucide-react';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { EmptyState, IconButton, Input } from '@/components/ui/primitives';
import { cn } from '@/utils/cn';
import { buildTree, flattenVisible } from './tree';

const GIT_COLOR: Record<string, string> = { M: 'text-warning', A: 'text-success', '?': 'text-success', D: 'text-danger' };

export function Explorer() {
  const tree = useWorkspaceStore((s) => s.tree);
  const truncated = useWorkspaceStore((s) => s.truncated);
  const name = useWorkspaceStore((s) => s.name);
  const error = useWorkspaceStore((s) => s.error);
  const activePath = useWorkspaceStore((s) => s.activePath);
  const git = useWorkspaceStore((s) => s.git);
  const buffers = useWorkspaceStore((s) => s.buffers);
  const openFile = useWorkspaceStore((s) => s.openFile);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const nodes = useMemo(() => buildTree(tree), [tree]);
  const gitStatus = useMemo(() => new Map((git?.files ?? []).map((f) => [f.path, f.status.trim().charAt(0) || 'M'])), [git]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) {
      return tree
        .filter((e) => e.type === 'file' && e.path.toLowerCase().includes(q))
        .slice(0, 300)
        .map((e) => ({ node: { path: e.path, name: e.path, type: 'file' as const, children: [] }, depth: 0 }));
    }
    return flattenVisible(nodes, expanded);
  }, [nodes, expanded, query, tree]);

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const onUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    const payload: Array<{ path: string; content: string }> = [];
    for (const file of Array.from(files)) payload.push({ path: file.name, content: await file.text() });
    try {
      const result = await useWorkspaceStore.getState().uploadFiles(payload);
      setNotice(result.errors.length ? result.errors.join('; ') : `Uploaded ${result.saved.length} file(s) to the project root.`);
    } catch (err) {
      setNotice((err as Error).message);
    }
    if (fileInput.current) fileInput.current.value = '';
  };

  return (
    <div className="flex h-full min-w-0 flex-col bg-surface">
      <div className="flex h-8 shrink-0 items-center justify-between gap-1 border-b border-line pl-3 pr-1.5">
        <span className="min-w-0 truncate text-[11.5px] font-semibold uppercase tracking-wide text-fg-subtle">{name || 'Explorer'}</span>
        <div className="flex shrink-0 items-center">
          <IconButton icon={Upload} label="Upload files into the project root" size="sm" onClick={() => fileInput.current?.click()} />
          <IconButton icon={RefreshCw} label="Refresh files" size="sm" onClick={() => void useWorkspaceStore.getState().refreshTree()} />
        </div>
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => void onUpload(e.target.files)} />
      </div>
      <div className="relative shrink-0 border-b border-line p-1.5">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search files" aria-label="Search files" className="h-6 pl-7" />
      </div>
      {notice ? <p className="border-b border-line bg-surface-2 px-3 py-1 text-[11.5px] text-fg-muted" role="status">{notice}</p> : null}
      <div role="tree" aria-label="Project files" className="min-h-0 flex-1 overflow-y-auto py-1">
        {error ? <p className="px-3 py-2 text-[12px] text-danger">{error}</p> : null}
        {rows.length === 0 && !error ? <EmptyState icon={Folder} title={query ? 'No matching files' : 'No files'}>{query ? 'Try a different search.' : 'Choose a project folder in Settings.'}</EmptyState> : null}
        {rows.map(({ node, depth }) => {
          const isDir = node.type === 'directory';
          const open = expanded.has(node.path);
          const status = gitStatus.get(node.path);
          const dirty = buffers[node.path] && buffers[node.path].content !== buffers[node.path].savedContent;
          return (
            <button
              key={node.path}
              type="button"
              role="treeitem"
              aria-expanded={isDir ? open : undefined}
              aria-selected={activePath === node.path}
              onClick={() => (isDir ? toggle(node.path) : void openFile(node.path))}
              style={{ paddingLeft: 8 + depth * 12 }}
              title={node.path}
              className={cn('flex h-6 w-full items-center gap-1 pr-2 text-left text-[12.5px] hover:bg-surface-2', activePath === node.path ? 'bg-accent-soft text-fg' : 'text-fg-muted')}
            >
              {isDir ? (open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />) : <span className="w-3 shrink-0" />}
              {isDir ? (open ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-fg-subtle" /> : <Folder className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />) : <File className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />}
              <span className="min-w-0 truncate">{node.name}</span>
              {dirty ? <span className="ml-auto shrink-0 text-accent" aria-label="unsaved">●</span> : status ? <span className={cn('ml-auto shrink-0 font-mono text-[10.5px]', GIT_COLOR[status] ?? 'text-fg-subtle')}>{status}</span> : null}
            </button>
          );
        })}
        {truncated ? <p className="px-3 py-2 text-[11.5px] text-fg-subtle">File list truncated. Use search to find files.</p> : null}
      </div>
    </div>
  );
}
