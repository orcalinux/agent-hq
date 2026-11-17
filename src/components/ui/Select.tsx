import {
  Children,
  forwardRef,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '@/utils/cn';

export interface SelectChangeEvent {
  target: { value: string };
}

export interface SelectProps {
  value?: string;
  onChange?: (e: SelectChangeEvent) => void;
  children?: ReactNode;
  className?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
  title?: string;
  placeholder?: string;
  'aria-label'?: string;
}

interface Item {
  value: string;
  label: string;
  group?: string;
  disabled?: boolean;
}

function textOf(node: ReactNode): string {
  return Children.toArray(node)
    .map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : isValidElement(c) ? textOf((c as ReactElement<{ children?: ReactNode }>).props.children) : ''))
    .join('');
}

function parseItems(children: ReactNode, group?: string): Item[] {
  const out: Item[] = [];
  Children.toArray(children).forEach((child) => {
    if (!isValidElement(child)) return;
    const props = child.props as { value?: string | number; label?: string; disabled?: boolean; children?: ReactNode };
    if (child.type === 'optgroup') out.push(...parseItems(props.children, props.label));
    else if (child.type === 'option') {
      const label = textOf(props.children);
      out.push({ value: props.value !== undefined ? String(props.value) : label, label, group, disabled: props.disabled });
    }
  });
  return out;
}

const MENU_MAX_H = 320;

/** Styled listbox with the same API as a native select (children are option/optgroup elements). */
export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(
  { value = '', onChange, children, className, disabled, id, title, placeholder = 'Select…', 'aria-label': ariaLabel },
  ref
) {
  const items = useMemo(() => parseItems(children), [children]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; up: boolean } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const typeahead = useRef({ text: '', at: 0 });
  const listId = useId();
  useImperativeHandle(ref, () => triggerRef.current as HTMLButtonElement);

  const selected = items.find((i) => i.value === value);
  const searchable = items.length > 8;
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((i) => (i.label + ' ' + (i.group ?? '')).toLowerCase().includes(q)) : items;
  }, [items, query]);

  const place = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom;
    const up = below < Math.min(MENU_MAX_H, 240) && r.top > below;
    const width = Math.max(r.width, 200);
    const left = Math.min(r.left, window.innerWidth - width - 8);
    setPos({ top: up ? r.top - 4 : r.bottom + 4, left: Math.max(8, left), width, up });
  }, []);

  const openMenu = useCallback(() => {
    if (disabled) return;
    setQuery('');
    const idx = items.findIndex((i) => i.value === value);
    setActive(idx >= 0 ? idx : 0);
    place();
    setOpen(true);
  }, [disabled, items, value, place]);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  const choose = useCallback(
    (item: Item | undefined) => {
      if (!item || item.disabled) return;
      if (item.value !== value) onChange?.({ target: { value: item.value } });
      close();
    },
    [value, onChange, close]
  );

  useLayoutEffect(() => {
    if (!open) return;
    if (searchable) searchRef.current?.focus();
    else listRef.current?.focus();
  }, [open, searchable]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !triggerRef.current?.contains(t)) close(false);
    };
    const onMove = () => place();
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open, close, place]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const move = (delta: number) => {
    if (visible.length === 0) return;
    let next = active;
    for (let n = 0; n < visible.length; n += 1) {
      next = (next + delta + visible.length) % visible.length;
      if (!visible[next].disabled) break;
    }
    setActive(next);
  };

  const onMenuKey = (e: ReactKeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(-1);
        break;
      case 'Home':
        if (!searchable) {
          e.preventDefault();
          setActive(0);
        }
        break;
      case 'End':
        if (!searchable) {
          e.preventDefault();
          setActive(visible.length - 1);
        }
        break;
      case 'Enter':
        e.preventDefault();
        choose(visible[active]);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        close();
        break;
      case 'Tab':
        close(false);
        break;
      default:
        if (!searchable && e.key.length === 1) {
          const now = Date.now();
          const t = typeahead.current;
          t.text = now - t.at > 600 ? e.key.toLowerCase() : t.text + e.key.toLowerCase();
          t.at = now;
          const idx = visible.findIndex((i) => i.label.toLowerCase().startsWith(t.text));
          if (idx >= 0) setActive(idx);
        }
    }
  };

  const onTriggerKey = (e: ReactKeyboardEvent) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      openMenu();
    }
  };

  const activeId = visible[active] ? listId + '-' + active : undefined;
  let lastGroup: string | undefined;

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        title={title ?? selected?.label}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={onTriggerKey}
        className={cn(
          'group inline-flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md border border-line bg-surface pl-2 pr-1.5 text-left text-[12.5px] text-fg transition-colors',
          'hover:border-line-strong hover:bg-surface-2 focus-visible:border-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
          open && 'border-accent',
          className
        )}
      >
        {selected?.group ? <span className="shrink-0 text-fg-subtle">{selected.group} ·</span> : null}
        <span className={cn('min-w-0 flex-1 truncate', !selected?.label && 'text-fg-subtle')}>{selected?.label || (value ? value : placeholder)}</span>
        <ChevronDown aria-hidden className={cn('h-3.5 w-3.5 shrink-0 text-fg-subtle transition-transform duration-150', open && 'rotate-180')} />
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              data-ahq-popover=""
              onKeyDown={onMenuKey}
              style={{ position: 'fixed', left: pos.left, width: pos.width, maxWidth: 440, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }}
              className={cn('ahq-pop z-[70] flex flex-col overflow-hidden rounded-lg border border-line-strong bg-surface shadow-[0_8px_28px_rgba(0,0,0,0.28)]', pos.up ? 'origin-bottom' : 'origin-top')}
            >
              {searchable ? (
                <div className="flex items-center gap-1.5 border-b border-line px-2">
                  <Search aria-hidden className="h-3.5 w-3.5 text-fg-subtle" />
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setActive(0);
                    }}
                    placeholder="Search"
                    aria-label="Search options"
                    aria-controls={listId}
                    aria-activedescendant={activeId}
                    className="h-8 w-full bg-transparent text-[12.5px] text-fg placeholder:text-fg-subtle focus:outline-none"
                  />
                </div>
              ) : null}
              <ul
                ref={listRef}
                id={listId}
                role="listbox"
                tabIndex={-1}
                aria-label={ariaLabel}
                aria-activedescendant={activeId}
                className="overflow-y-auto p-1 focus:outline-none"
                style={{ maxHeight: MENU_MAX_H }}
              >
                {visible.length === 0 ? <li className="px-2 py-1.5 text-[12px] text-fg-subtle">No matches</li> : null}
                {visible.map((item, i) => {
                  const header = item.group && item.group !== lastGroup ? item.group : null;
                  lastGroup = item.group;
                  const isSel = item.value === value;
                  return (
                    <li key={item.group + '\u0000' + item.value} role="presentation">
                      {header ? <div className="px-2 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-fg-subtle">{header}</div> : null}
                      <div
                        id={listId + '-' + i}
                        role="option"
                        aria-selected={isSel}
                        aria-disabled={item.disabled || undefined}
                        data-active={i === active}
                        onPointerMove={() => i !== active && setActive(i)}
                        onClick={() => choose(item)}
                        className={cn(
                          'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px]',
                          i === active ? 'bg-surface-3 text-fg' : 'text-fg-muted',
                          isSel && 'text-fg',
                          item.disabled && 'cursor-not-allowed opacity-50'
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">{item.label || <span className="text-fg-subtle">—</span>}</span>
                        {isSel ? <Check aria-hidden className="h-3.5 w-3.5 shrink-0 text-accent" /> : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>,
            document.body
          )
        : null}
    </>
  );
});
