import { memo, useMemo } from 'react';
import { Check, Code2, Columns2, RotateCcw, Save, X } from 'lucide-react';
import { isDirty, useWorkspaceStore } from '@/store/useWorkspaceStore';
import { Badge, Button, EmptyState, IconButton, Spinner } from '@/components/ui/primitives';
import { Kbd } from '@/components/ui/primitives';
import { computeLineDiff, highlightLine, diffStats } from '@/utils/diffParser';
import { cn } from '@/utils/cn';
import { useState } from 'react';

const LINE_HEIGHT = 18;
const SAVE_SHORTCUT = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘S' : 'Ctrl+S';

function fileDot(name: string): string {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  if (['ts', 'tsx'].includes(ext)) return 'bg-[#4f9dff]';
  if (['js', 'jsx', 'mjs', 'cjs'].includes(ext)) return 'bg-[#f5c542]';
  if (['json', 'yml', 'yaml', 'toml'].includes(ext)) return 'bg-[#e8a35c]';
  if (['md', 'mdx', 'txt'].includes(ext)) return 'bg-[#8bd3a8]';
  if (['css', 'scss', 'html'].includes(ext)) return 'bg-[#e86fa5]';
  if (['py', 'rs', 'go'].includes(ext)) return 'bg-[#9b8cff]';
  return 'bg-fg-subtle';
}
const HIGHLIGHT_LIMIT_LINES = 4000;

const HighlightedLines = memo(function HighlightedLines({ content, language }: { content: string; language: string }) {
  const lines = useMemo(() => content.split('\n'), [content]);
  return (
    <>
      {lines.map((line, i) => (
        <div key={i} style={{ height: LINE_HEIGHT }}>
          {line === '' ? '\u200b' : highlightLine(line, language).map((t, j) => (
            <span key={j} className={t.className}>{t.text}</span>
          ))}
        </div>
      ))}
    </>
  );
});

function CodeView({ path }: { path: string }) {
  const buffer = useWorkspaceStore((s) => s.buffers[path]);
  const edit = useWorkspaceStore((s) => s.editBuffer);
  const content = buffer?.content ?? '';
  const lineCount = useMemo(() => content.split('\n').length, [content]);
  const widest = useMemo(() => content.split('\n').reduce((n, l) => Math.max(n, l.length), 0), [content]);
  const highlight = lineCount <= HIGHLIGHT_LIMIT_LINES;
  const gutterWidth = String(lineCount).length * 8 + 20;
  const font = 'font-mono text-[12px]';

  return (
    <div className="relative min-h-0 flex-1 overflow-auto bg-surface">
      <div className="relative flex min-w-full" style={{ height: lineCount * LINE_HEIGHT + 24, width: `calc(${widest + 4}ch + ${gutterWidth}px)` }}>
        <div aria-hidden className={cn('sticky left-0 z-10 select-none border-r border-line bg-surface pr-2 pt-3 text-right text-fg-subtle', font)} style={{ width: gutterWidth, lineHeight: `${LINE_HEIGHT}px` }}>
          {Array.from({ length: lineCount }, (_, i) => <div key={i}>{i + 1}</div>)}
        </div>
        <div className="relative flex-1">
          {highlight ? (
            <pre aria-hidden className={cn('pointer-events-none absolute inset-0 m-0 px-3 pt-3', font)} style={{ lineHeight: `${LINE_HEIGHT}px` }}>
              <HighlightedLines content={content} language={buffer?.language ?? 'text'} />
            </pre>
          ) : null}
          <textarea
            aria-label={`Editing ${path}`}
            value={content}
            onChange={(e) => edit(path, e.target.value)}
            spellCheck={false}
            wrap="off"
            className={cn('absolute inset-0 m-0 h-full w-full resize-none overflow-hidden border-0 bg-transparent px-3 pt-3 outline-none', font, highlight ? 'text-transparent caret-[var(--fg)]' : 'text-fg')}
            style={{ lineHeight: `${LINE_HEIGHT}px`, tabSize: 2 }}
            onKeyDown={(e) => {
              if (e.key === 'Tab' && !e.shiftKey) {
                e.preventDefault();
                const el = e.currentTarget;
                const { selectionStart: start, selectionEnd: end } = el;
                edit(path, `${content.slice(0, start)}  ${content.slice(end)}`);
                requestAnimationFrame(() => el.setSelectionRange(start + 2, start + 2));
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}

function DiffView({ path }: { path: string }) {
  const buffer = useWorkspaceStore((s) => s.buffers[path]);
  const target = useWorkspaceStore((s) => s.diffTarget);
  const proposed = target && target.path === path ? target : null;
  const lines = useMemo(() => {
    if (!buffer) return [];
    return proposed ? computeLineDiff(buffer.savedContent, proposed.content) : computeLineDiff(buffer.savedContent, buffer.content);
  }, [buffer, proposed]);
  const stats = diffStats(lines);
  const changed = stats.additions + stats.deletions > 0;

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-surface">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-surface-2 px-3 py-1 text-[11.5px] text-fg-muted">
        <span>{proposed ? `Saved file ↔ ${proposed.label}` : 'Saved file ↔ editor (unsaved changes)'}</span>
        <span className="text-success">+{stats.additions}</span>
        <span className="text-danger">−{stats.deletions}</span>
      </div>
      {!changed ? <EmptyState title="No differences">{proposed ? 'The proposed content matches the file on disk.' : 'The editor matches the file on disk.'}</EmptyState> : null}
      <div className="font-mono text-[12px]" style={{ lineHeight: `${LINE_HEIGHT}px` }}>
        {lines.map((line, i) => (
          <div key={i} className={cn('flex whitespace-pre', line.type === 'add' && 'bg-success-soft', line.type === 'del' && 'bg-danger-soft', line.type === 'hunk' && 'bg-surface-2 text-fg-subtle')}>
            <span className="w-10 shrink-0 select-none pr-2 text-right text-fg-subtle">{line.oldLineNumber ?? ''}</span>
            <span className="w-10 shrink-0 select-none pr-2 text-right text-fg-subtle">{line.newLineNumber ?? ''}</span>
            <span className={cn('w-4 shrink-0 select-none', line.type === 'add' ? 'text-success' : line.type === 'del' ? 'text-danger' : 'text-fg-subtle')}>{line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' '}</span>
            <span className="text-fg">{line.content}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EditorPane() {
  const openTabs = useWorkspaceStore((s) => s.openTabs);
  const activePath = useWorkspaceStore((s) => s.activePath);
  const buffers = useWorkspaceStore((s) => s.buffers);
  const mode = useWorkspaceStore((s) => s.editorMode);
  const target = useWorkspaceStore((s) => s.diffTarget);
  const { setActive, closeTab, setEditorMode, saveFile, revertFile, showDiff } = useWorkspaceStore.getState();
  const [saveError, setSaveError] = useState<string | null>(null);
  const buffer = activePath ? buffers[activePath] : undefined;
  const dirty = isDirty(buffer);

  const save = async () => {
    if (!activePath) return;
    setSaveError(null);
    try {
      await saveFile(activePath);
    } catch (err) {
      setSaveError((err as Error).message);
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div role="tablist" aria-label="Open files" className="ahq-tabs flex h-10 shrink-0 items-end gap-1 overflow-x-auto border-b border-line bg-surface px-2 pt-1.5">
        {openTabs.map((p) => {
          const active = p === activePath;
          const unsaved = isDirty(buffers[p]);
          const name = p.split('/').pop() ?? p;
          return (
            <div
              key={p}
              className={cn(
                'ahq-tab group relative flex h-8 shrink-0 items-center gap-2 rounded-t-lg border border-b-0 pl-2.5 pr-1 text-[12.5px] transition-[background-color,color,border-color] duration-200',
                active ? 'border-line bg-canvas text-fg' : 'border-transparent text-fg-muted hover:bg-surface-2 hover:text-fg'
              )}
            >
              <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full transition-colors', fileDot(name))} />
              <button type="button" role="tab" aria-selected={active} onClick={() => setActive(p)} className="max-w-44 truncate outline-none" title={p}>
                {name}
              </button>
              <button
                type="button"
                aria-label={`Close ${p}`}
                title={unsaved ? 'Unsaved changes. Close' : 'Close'}
                onClick={() => closeTab(p)}
                className="relative flex h-5 w-5 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-surface-3 hover:text-fg"
              >
                <span aria-label={unsaved ? 'unsaved changes' : undefined} className={cn('absolute h-1.5 w-1.5 rounded-full bg-accent transition-all duration-150', unsaved ? 'scale-100 opacity-100 group-hover:scale-0 group-hover:opacity-0' : 'scale-0 opacity-0')} />
                <X className={cn('h-3 w-3 transition-all duration-150', unsaved ? 'scale-50 opacity-0 group-hover:scale-100 group-hover:opacity-100' : active ? 'opacity-70' : 'opacity-0 group-hover:opacity-70')} />
              </button>
              <span aria-hidden className={cn('absolute inset-x-2 -bottom-px h-0.5 origin-center rounded-full bg-gradient-to-r from-accent to-accent-2 transition-transform duration-300 [transition-timing-function:cubic-bezier(.32,.72,0,1)]', active ? 'scale-x-100' : 'scale-x-0')} />
            </div>
          );
        })}
      </div>
      {activePath && buffer ? (
        <>
          <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
            <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-fg-muted" title={activePath}>{activePath}</span>
            {saveError ? <span className="truncate text-[11.5px] text-danger" role="alert">{saveError}</span> : null}
            {target && target.path === activePath ? <Badge tone="accent">Proposed change</Badge> : null}
            <div className="flex items-center gap-0.5 rounded-md border border-line p-0.5">
              <IconButton icon={Code2} label="Edit" size="sm" active={mode === 'code'} onClick={() => setEditorMode('code')} />
              <IconButton icon={Columns2} label="Diff" size="sm" active={mode === 'diff'} onClick={() => setEditorMode('diff')} />
            </div>
            {target && target.path === activePath ? <Button size="sm" variant="ghost" onClick={() => showDiff(null)}>Clear proposal</Button> : null}
            <span aria-live="polite" className={cn('flex items-center gap-1 text-[11.5px] transition-colors', dirty ? 'text-warning' : 'text-fg-subtle')}>
              {dirty ? <span className="h-1.5 w-1.5 rounded-full bg-warning" /> : <Check className="h-3 w-3" />}
              {dirty ? 'Unsaved' : 'Saved'}
            </span>
            <Button size="sm" icon={RotateCcw} disabled={!dirty} onClick={() => revertFile(activePath)}>Revert</Button>
            <Button size="sm" variant="primary" icon={Save} disabled={!dirty || buffer.binary} onClick={() => void save()} title={`Save (${SAVE_SHORTCUT})`} aria-keyshortcuts="Control+S Meta+S">
              Save
            </Button>
          </div>
          {buffer.loading ? (
            <div className="flex flex-1 items-center justify-center"><Spinner /></div>
          ) : buffer.error ? (
            <EmptyState title="Could not open file">{buffer.error}</EmptyState>
          ) : buffer.binary ? (
            <EmptyState title="Binary file">This file cannot be shown as text.</EmptyState>
          ) : mode === 'diff' ? (
            <DiffView path={activePath} />
          ) : (
            <CodeView path={activePath} />
          )}
        </>
      ) : (
        <EmptyState icon={Code2} title="No file open">
          Pick a file in the explorer, press <Kbd>Ctrl K</Kbd> to search by name, or ask Sovereign to start a task.
        </EmptyState>
      )}
    </div>
  );
}
