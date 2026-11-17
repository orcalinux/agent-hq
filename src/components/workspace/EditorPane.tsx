import { memo, useMemo } from 'react';
import { Code2, Columns2, RotateCcw, Save, X } from 'lucide-react';
import { isDirty, useWorkspaceStore } from '@/store/useWorkspaceStore';
import { Badge, Button, EmptyState, IconButton, Spinner } from '@/components/ui/primitives';
import { Kbd } from '@/components/ui/primitives';
import { computeLineDiff, highlightLine, diffStats } from '@/utils/diffParser';
import { cn } from '@/utils/cn';
import { useState } from 'react';

const LINE_HEIGHT = 18;
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
      <div role="tablist" aria-label="Open files" className="flex h-8 shrink-0 items-stretch overflow-x-auto border-b border-line bg-surface">
        {openTabs.map((p) => {
          const active = p === activePath;
          return (
            <div key={p} className={cn('group flex shrink-0 items-center gap-1.5 border-r border-line pl-3 pr-1 text-[12.5px]', active ? 'bg-canvas text-fg' : 'text-fg-muted hover:bg-surface-2')}>
              <button type="button" role="tab" aria-selected={active} onClick={() => setActive(p)} className="max-w-48 truncate" title={p}>
                {p.split('/').pop()}
              </button>
              {isDirty(buffers[p]) ? <span className="text-accent" aria-label="unsaved changes">●</span> : null}
              <IconButton icon={X} label={`Close ${p}`} size="sm" className="opacity-60 group-hover:opacity-100" onClick={() => closeTab(p)} />
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
            <Button size="sm" icon={RotateCcw} disabled={!dirty} onClick={() => revertFile(activePath)}>Revert</Button>
            <Button size="sm" variant="primary" icon={Save} disabled={!dirty || buffer.binary} onClick={() => void save()}>
              Save <Kbd>Ctrl S</Kbd>
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
