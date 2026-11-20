import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { findTruncatedTarget, fullTextOf, isTextTruncated, placeOverflowTooltip, type Placement } from '@/utils/overflow';

const SHOW_DELAY = 450;
const WARM_WINDOW = 700;
const HIDE_GRACE = 90;

interface Shown {
  anchor: HTMLElement;
  text: string;
}

/**
 * One tooltip for the whole window. It listens at the document, so any text truncated with the shared
 * classes (`truncate`, `line-clamp-*`, `data-truncate`, or <Truncate>) gets it with no per-screen code.
 * It appears only while the text is actually cut off, measured at the moment of hover or focus, so it
 * follows window and pane resizes. It is portalled to <body> so no parent can clip it, can be hovered
 * and selected, and closes on Escape, scroll, click or blur. The full text is already in the element,
 * so the tooltip is hidden from assistive technology to avoid reading it twice.
 */
export function OverflowTooltipHost() {
  const [shown, setShown] = useState<Shown | null>(null);
  const [place, setPlace] = useState<Placement | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const state = useRef({ anchor: null as HTMLElement | null, pending: null as HTMLElement | null, showTimer: 0, hideTimer: 0, lastHidden: 0, overTip: false });

  useEffect(() => {
    const s = state.current;
    const clearTimers = () => {
      window.clearTimeout(s.showTimer);
      window.clearTimeout(s.hideTimer);
      s.pending = null;
    };
    const hideNow = () => {
      clearTimers();
      if (s.anchor) s.lastHidden = Date.now();
      s.anchor = null;
      s.overTip = false;
      setShown(null);
      setPlace(null);
    };
    const show = (anchor: HTMLElement) => {
      clearTimers();
      if (!anchor.isConnected || !isTextTruncated(anchor)) return hideNow();
      s.anchor = anchor;
      setPlace(null);
      setShown({ anchor, text: fullTextOf(anchor) });
    };
    const scheduleShow = (anchor: HTMLElement, immediate: boolean) => {
      window.clearTimeout(s.hideTimer);
      if (s.anchor === anchor || (s.pending === anchor && !immediate)) return;
      clearTimers();
      const warm = Date.now() - s.lastHidden < WARM_WINDOW || s.anchor !== null;
      if (immediate || warm) show(anchor);
      else {
        s.pending = anchor;
        s.showTimer = window.setTimeout(() => show(anchor), SHOW_DELAY);
      }
    };
    const scheduleHide = () => {
      window.clearTimeout(s.showTimer);
      window.clearTimeout(s.hideTimer);
      s.pending = null;
      if (!s.anchor) return;
      s.hideTimer = window.setTimeout(() => {
        if (!s.overTip) hideNow();
      }, HIDE_GRACE);
    };

    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const target = e.target as Element | null;
      if (target && tipRef.current?.contains(target)) {
        s.overTip = true;
        window.clearTimeout(s.hideTimer);
        return;
      }
      s.overTip = false;
      const anchor = findTruncatedTarget(target);
      if (anchor) scheduleShow(anchor, false);
      else scheduleHide();
    };
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as Element | null;
      if (!target?.matches?.(':focus-visible')) return;
      const anchor = findTruncatedTarget(target);
      if (anchor) scheduleShow(anchor, true);
      else hideNow();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && s.anchor) hideNow();
    };
    const onLeaveWindow = (e: PointerEvent) => {
      if (!e.relatedTarget) scheduleHide();
    };

    document.addEventListener('pointerover', onOver, true);
    document.addEventListener('pointerout', onLeaveWindow, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', scheduleHide, true);
    document.addEventListener('pointerdown', hideNow, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('wheel', hideNow, { capture: true, passive: true });
    window.addEventListener('scroll', hideNow, true);
    window.addEventListener('resize', hideNow);
    window.addEventListener('blur', hideNow);
    return () => {
      clearTimers();
      document.removeEventListener('pointerover', onOver, true);
      document.removeEventListener('pointerout', onLeaveWindow, true);
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('focusout', scheduleHide, true);
      document.removeEventListener('pointerdown', hideNow, true);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('wheel', hideNow, true);
      window.removeEventListener('scroll', hideNow, true);
      window.removeEventListener('resize', hideNow);
      window.removeEventListener('blur', hideNow);
    };
  }, []);

  useLayoutEffect(() => {
    if (!shown || !tipRef.current) return;
    const anchor = shown.anchor.getBoundingClientRect();
    const tip = tipRef.current.getBoundingClientRect();
    const rtl = getComputedStyle(shown.anchor).direction === 'rtl';
    setPlace(placeOverflowTooltip(anchor, { width: tip.width, height: tip.height }, { width: window.innerWidth, height: window.innerHeight }, rtl));
  }, [shown]);

  if (!shown) return null;
  return createPortal(
    <div
      ref={tipRef}
      role="tooltip"
      aria-hidden="true"
      dir="auto"
      data-overflow-tooltip=""
      data-side={place?.side}
      onPointerLeave={() => {
        state.current.overTip = false;
        window.setTimeout(() => {
          if (!state.current.overTip && state.current.anchor && !state.current.anchor.matches(':hover')) {
            state.current.anchor = null;
            state.current.lastHidden = Date.now();
            setShown(null);
            setPlace(null);
          }
        }, HIDE_GRACE);
      }}
      style={{ position: 'fixed', left: place?.left ?? 0, top: place?.top ?? 0, visibility: place ? 'visible' : 'hidden' }}
      className="ahq-tooltip pointer-events-auto z-[200] max-h-[40vh] w-max max-w-[min(440px,calc(100vw-16px))] select-text overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-line-strong bg-surface-2 px-2 py-1 text-[12px] leading-snug text-fg shadow-pop [overflow-wrap:anywhere]"
    >
      {shown.text}
    </div>,
    document.body
  );
}
