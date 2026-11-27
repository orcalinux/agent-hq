import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { AtSign, BookOpen, CornerDownRight, Hash } from 'lucide-react';
import { useAgentStore } from '@/store/useAgentStore';
import { listAvailableModels, useConnectionsStore } from '@/store/useConnectionsStore';
import { Kbd } from '@/components/ui/primitives';
import { applyCompletion, chatSuggestions, completionToken, type ChatSuggestion } from '@/utils/chatCompletion';
import { cn } from '@/utils/cn';

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  placeholder: string;
}

export function ChatInput({ value, onChange, onSend, placeholder }: ChatInputProps) {
  const agents = useAgentStore((store) => store.agents);
  const mission = useAgentStore((store) => store.activeMission);
  const providers = useConnectionsStore((store) => store.providers);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionListRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState(0);
  const [selectionEnd, setSelectionEnd] = useState(0);
  const lastSelection = useRef({ start: 0, end: 0 });
  const pendingCaret = useRef<{ text: string; cursor: number } | null>(null);
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<{ left: number; bottom: number; width: number; maxHeight: number } | null>(null);
  const listId = useId();
  const hintId = useId();
  const token = useMemo(() => completionToken(value, cursor, selectionEnd), [value, cursor, selectionEnd]);
  const completionOptions = useMemo(() => ({
    tasks: (mission?.tasks ?? []).map((t) => ({ id: t.id, title: t.title, status: t.status })),
    models: listAvailableModels(providers),
  }), [mission?.tasks, providers]);
  const suggestions = useMemo(() => token ? chatSuggestions(token, Object.values(agents), completionOptions) : [], [token, agents, completionOptions]);
  const open = focused && !composing && !dismissed && Boolean(token);
  const selected = Math.min(active, Math.max(0, suggestions.length - 1));
  const optionId = (index: number) => `${listId}-${index}`;

  const syncSelection = useCallback(() => {
    const input = inputRef.current;
    if (!input || document.activeElement !== input) return;
    if (lastSelection.current.start === input.selectionStart && lastSelection.current.end === input.selectionEnd) return;
    lastSelection.current = { start: input.selectionStart, end: input.selectionEnd };
    setCursor(input.selectionStart);
    setSelectionEnd(input.selectionEnd);
    setDismissed(false);
  }, []);

  useEffect(() => {
    const input = inputRef.current;
    input?.addEventListener('select', syncSelection);
    document.addEventListener('selectionchange', syncSelection);
    return () => {
      input?.removeEventListener('select', syncSelection);
      document.removeEventListener('selectionchange', syncSelection);
    };
  }, [syncSelection]);

  useEffect(() => {
    setActive(0);
  }, [token?.query, token?.kind, token?.start]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const bounds = inputRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const width = Math.min(bounds.width, window.innerWidth - 16, 480);
      setPosition({
        left: Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8)),
        bottom: Math.max(8, window.innerHeight - bounds.top + 6),
        width,
        maxHeight: Math.max(0, Math.min(300, bounds.top - 14)),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    if (inputRef.current) observer.observe(inputRef.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    optionListRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, selected, suggestions]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && event.target !== inputRef.current) setDismissed(true);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  useLayoutEffect(() => {
    const pending = pendingCaret.current;
    const input = inputRef.current;
    if (!pending || !input || input.value !== pending.text) return;
    pendingCaret.current = null;
    if (document.activeElement !== input) input.focus();
    input.setSelectionRange(pending.cursor, pending.cursor);
  });

  const choose = (suggestion: ChatSuggestion) => {
    if (!token) return;
    const result = applyCompletion(value, token, suggestion);
    setDismissed(!suggestion.hasArgs);
    lastSelection.current = { start: result.cursor, end: result.cursor };
    pendingCaret.current = { text: result.text, cursor: result.cursor };
    onChange(result.text);
    setCursor(result.cursor);
    setSelectionEnd(result.cursor);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || composing || event.keyCode === 229) return;
    if (open) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setDismissed(true);
        return;
      }
      if (suggestions.length && !event.shiftKey && ['ArrowDown', 'ArrowUp', 'Tab', 'Enter'].includes(event.key)) {
        event.preventDefault();
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          setActive((selected + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length);
        } else {
          choose(suggestions[selected]);
        }
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  };

  return (
    <>
      <textarea
        ref={inputRef}
        id="orchestrator-input"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          syncSelection();
          setDismissed(false);
        }}
        onFocus={() => {
          setFocused(true);
          syncSelection();
        }}
        onBlur={() => setFocused(false)}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
        onKeyDown={onKeyDown}
        rows={3}
        placeholder={placeholder}
        aria-label="Message Sovereign"
        aria-autocomplete="list"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && suggestions.length ? optionId(selected) : undefined}
        aria-describedby={hintId}
        className="block w-full resize-none bg-transparent px-2.5 pt-2 text-[13px] placeholder:text-fg-subtle focus:outline-none"
      />
      <div id={hintId} className="px-2.5 py-1 text-[10.5px] text-fg-subtle">Type / for commands · @ for agents · # for tasks</div>
      <span role="status" className="sr-only">
        {open ? `${suggestions.length} ${token?.kind === 'agent' ? 'agents' : token?.kind === 'task' ? 'tasks' : token?.kind === 'argument' ? 'options' : 'commands'} found. Use up and down arrows to choose, Tab or Enter to insert, Escape to dismiss.` : ''}
      </span>
      {open && position ? createPortal(
        <div
          ref={menuRef}
          data-ahq-popover=""
          data-testid="chat-completions"
          data-open="true"
          data-direction="up"
          className="ahq-menu-surface fixed z-[80] flex min-h-0 flex-col overflow-hidden rounded-xl border border-line-strong bg-surface shadow-xl"
          style={position}
          onPointerDown={(event) => event.preventDefault()}
        >
          <div className="shrink-0 border-b border-line px-3 py-2 text-[11px] font-medium text-fg-subtle">
            {token?.kind === 'agent' ? 'Agents' : token?.kind === 'task' ? 'Tasks' : token?.kind === 'argument' ? `/${token.command} options` : 'Commands'}
          </div>
          <div ref={optionListRef} id={listId} role="listbox" aria-label={token?.kind === 'agent' ? 'Mention an agent' : token?.kind === 'task' ? 'Cite a task' : token?.kind === 'argument' ? 'Command options' : 'Chat commands'} className="min-h-0 overflow-y-auto p-1">
            {suggestions.length ? suggestions.map((suggestion, index) => {
              const Icon = token?.kind === 'agent' ? AtSign : token?.kind === 'task' ? Hash : token?.kind === 'argument' ? CornerDownRight : BookOpen;
              return (
                <div
                  key={suggestion.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === selected}
                  onPointerMove={() => setActive(index)}
                  onClick={() => choose(suggestion)}
                  className={cn('ahq-menu-item flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2', index === selected ? 'bg-accent-soft text-accent' : 'text-fg')}
                >
                  <Icon aria-hidden className="h-4 w-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-medium">{suggestion.label}</div>
                    <div className="truncate text-[11px] text-fg-muted">{suggestion.detail}</div>
                  </div>
                </div>
              );
            }) : <p className="px-2 py-3 text-[12px] text-fg-muted">No matching {token?.kind === 'agent' ? 'agents' : token?.kind === 'task' ? 'tasks' : token?.kind === 'argument' ? 'options' : 'commands'}.</p>}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-3 py-1.5 text-[10.5px] text-fg-subtle">
            <span><Kbd>↑↓</Kbd> choose</span><span><Kbd>Tab</Kbd> / <Kbd>↵</Kbd> insert</span><span><Kbd>Esc</Kbd> close</span>
          </div>
        </div>,
        document.body
      ) : null}
    </>
  );
}
