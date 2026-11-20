import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export function usePresence(open: boolean, exitMs = 160) {
  const [retained, setRetained] = useState(open);
  useLayoutEffect(() => {
    if (open) {
      setRetained(true);
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setRetained(false);
      return;
    }
    const timer = window.setTimeout(() => setRetained(false), exitMs);
    return () => window.clearTimeout(timer);
  }, [open, exitMs]);
  return open || retained;
}

export function Presence<Value>({ value, children }: { value: Value | null | undefined; children: (value: NonNullable<Value>, open: boolean) => ReactNode }) {
  const open = value != null;
  const present = usePresence(open);
  const previous = useRef(value);
  useLayoutEffect(() => {
    if (value != null) previous.current = value;
  }, [value]);
  const current = value ?? previous.current;
  return present && current != null ? children(current, open) : null;
}

export function useSelectionIndicator<Element extends HTMLElement = HTMLDivElement>(value: string, selector: string) {
  const containerRef = useRef<Element>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const initialized = useRef(false);
  const frame = useRef(0);
  const measure = useCallback((animate: boolean) => {
    const container = containerRef.current;
    const indicator = indicatorRef.current;
    if (!container || !indicator) return;
    const selected = container.querySelector<HTMLElement>(selector);
    if (!selected) {
      indicator.style.opacity = '0';
      initialized.current = false;
      return;
    }
    const bounds = container.getBoundingClientRect();
    const target = selected.getBoundingClientRect();
    const left = target.left - bounds.left - container.clientLeft + container.scrollLeft;
    const top = target.top - bounds.top - container.clientTop + container.scrollTop;
    cancelAnimationFrame(frame.current);
    if (!animate || !initialized.current) indicator.style.transition = 'none';
    indicator.style.width = `${target.width}px`;
    indicator.style.height = `${target.height}px`;
    indicator.style.transform = `translate(${left}px, ${top}px)`;
    indicator.style.opacity = '1';
    initialized.current = true;
    frame.current = requestAnimationFrame(() => indicator.style.removeProperty('transition'));
  }, [selector]);
  useLayoutEffect(() => measure(true), [value, measure]);
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => measure(false));
    observer.observe(container);
    for (const element of container.querySelectorAll('button')) observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame.current);
    };
  }, [measure]);
  return { containerRef, indicatorRef };
}
