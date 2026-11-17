import { MessageSquare, PanelBottom, PanelLeft, PanelsTopLeft } from 'lucide-react';
import { useLayoutStore } from '@/store/useLayoutStore';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { IconButton } from '@/components/ui/primitives';
import { Splitter } from '@/components/ui/Splitter';
import { Explorer } from './Explorer';
import { EditorPane } from './EditorPane';
import { BottomPanel } from './BottomPanel';
import { ChatPanel } from './ChatPanel';
import { cn } from '@/utils/cn';

export function WorkspaceView() {
  const L = useLayoutStore();
  const name = useWorkspaceStore((s) => s.name);
  const chatFocus = L.workspaceLayout === 'chat';
  const showExplorer = L.explorerVisible && !chatFocus;
  const showBottom = L.bottomVisible && !chatFocus;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
        <span className="truncate text-[13px] font-medium">{name || 'Workspace'}</span>
        <div className="ml-auto flex items-center gap-0.5">
          <div className="mr-2 flex items-center rounded-md border border-line p-0.5" role="group" aria-label="Layout">
            <button type="button" aria-pressed={!chatFocus} onClick={() => L.set({ workspaceLayout: 'code' })} className={cn('h-6 rounded px-2 text-[12px]', !chatFocus ? 'bg-surface-3 text-fg' : 'text-fg-muted hover:text-fg')}>Code</button>
            <button type="button" aria-pressed={chatFocus} onClick={() => L.set({ workspaceLayout: 'chat', chatVisible: true })} className={cn('h-6 rounded px-2 text-[12px]', chatFocus ? 'bg-surface-3 text-fg' : 'text-fg-muted hover:text-fg')}>Chat</button>
          </div>
          <IconButton icon={PanelLeft} label="Toggle explorer (Ctrl+B)" active={showExplorer} disabled={chatFocus} onClick={() => L.toggle('explorerVisible')} />
          <IconButton icon={PanelBottom} label="Toggle bottom panel (Ctrl+J)" active={showBottom} disabled={chatFocus} onClick={() => L.toggle('bottomVisible')} />
          <IconButton icon={MessageSquare} label="Toggle orchestrator chat (Ctrl+L)" active={L.chatVisible} onClick={() => L.toggle('chatVisible')} />
          <IconButton icon={PanelsTopLeft} label="Reset panel layout" onClick={L.reset} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        {showExplorer ? (
          <>
            <div style={{ width: L.explorerWidth }} className="shrink-0 overflow-hidden"><Explorer /></div>
            <Splitter orientation="vertical" side="start" size={L.explorerWidth} onResize={(v) => L.set({ explorerWidth: v })} min={160} max={480} label="Resize explorer" />
          </>
        ) : null}
        <div className={cn('flex min-w-0 flex-col', chatFocus ? 'w-[38%] shrink-0' : 'flex-1')}>
          <div className="min-h-0 flex-1 bg-canvas"><EditorPane /></div>
          {showBottom ? (
            <>
              <Splitter orientation="horizontal" side="end" size={L.bottomHeight} onResize={(v) => L.set({ bottomHeight: v })} min={100} max={520} label="Resize bottom panel" />
              <div style={{ height: L.bottomHeight }} className="shrink-0 overflow-hidden"><BottomPanel /></div>
            </>
          ) : null}
        </div>
        {L.chatVisible ? (
          <>
            <Splitter orientation="vertical" side="end" size={L.chatWidth} onResize={(v) => L.set({ chatWidth: v })} min={300} max={760} label="Resize chat" />
            <div style={chatFocus ? undefined : { width: L.chatWidth }} className={cn('overflow-hidden', chatFocus ? 'min-w-0 flex-1' : 'shrink-0')}><ChatPanel /></div>
          </>
        ) : null}
      </div>
    </div>
  );
}
