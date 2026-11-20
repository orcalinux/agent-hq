/**
 * Shared overflow handling. Text truncates with CSS (`truncate`, `line-clamp-*`, or `data-truncate`),
 * so the full text always stays in the DOM for assistive technology; the overflow tooltip shows it
 * to pointer and keyboard users only when the rendered text does not fit.
 */

/** Elements whose text may be cut off with an ellipsis. */
export const TRUNCATABLE_SELECTOR = '.truncate, .text-ellipsis, [data-truncate], [class*="line-clamp-"]';

/** Controls that host a truncated label: hovering or focusing anywhere on them reveals it. */
export const TOOLTIP_HOST_SELECTOR =
  'button, a[href], summary, label, td, th, [role="tab"], [role="option"], [role="menuitem"], [role="treeitem"], [role="link"], [role="button"], [tabindex]:not([tabindex="-1"])';

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Placement {
  left: number;
  top: number;
  side: 'below' | 'above';
}

const GAP = 6;
const MARGIN = 8;

/**
 * Puts the tooltip just below the text (above when there is no room), aligned to the text's start edge
 * and kept inside the viewport on every side.
 */
export function placeOverflowTooltip(anchor: Box, size: { width: number; height: number }, viewport: { width: number; height: number }, rtl = false): Placement {
  const below = anchor.bottom + GAP;
  const above = anchor.top - GAP - size.height;
  const fitsBelow = below + size.height <= viewport.height - MARGIN;
  const side: Placement['side'] = fitsBelow || above < MARGIN ? 'below' : 'above';
  const rawTop = side === 'below' ? below : above;
  const top = Math.max(MARGIN, Math.min(rawTop, viewport.height - MARGIN - size.height));
  const rawLeft = rtl ? anchor.right - size.width : anchor.left;
  const left = Math.max(MARGIN, Math.min(rawLeft, viewport.width - MARGIN - size.width));
  return { left: Math.round(left), top: Math.round(top), side };
}

function px(value: string): number {
  return Number.parseFloat(value) || 0;
}

/** True when the element's rendered text is wider (or, for clamped text, taller) than its box. */
export function isTextTruncated(el: HTMLElement): boolean {
  if (el.clientWidth === 0 && el.clientHeight === 0) return false;
  const clamped = /(?:^|\s)line-clamp-/.test(el.className) || getComputedStyle(el).webkitLineClamp !== 'none';
  if (clamped && el.scrollHeight - el.clientHeight > 1) return true;
  if (el.scrollWidth - el.clientWidth > 0) return true;
  if (clamped) return false;
  const range = document.createRange();
  range.selectNodeContents(el);
  const textWidth = range.getBoundingClientRect().width;
  const style = getComputedStyle(el);
  const inner = el.getBoundingClientRect().width - px(style.paddingLeft) - px(style.paddingRight) - px(style.borderLeftWidth) - px(style.borderRightWidth);
  return textWidth - inner > 0.5;
}

/** The full text of a truncated element, with whitespace collapsed as it is displayed. */
export function fullTextOf(el: HTMLElement): string {
  return (el.dataset.fullText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function hasNativeTooltip(el: Element, host: Element | null): boolean {
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (node.hasAttribute('title') && node.getAttribute('title')) return true;
    if (!host || node === host) break;
  }
  return false;
}

/**
 * Finds the truncated text to explain for a hovered or focused element. A truncated element under the
 * pointer wins; otherwise the first truncated label inside the hovered control. Opt out with
 * `data-no-overflow-tooltip`, and elements with their own `title` keep their native tooltip.
 */
export function findTruncatedTarget(start: Element | null): HTMLElement | null {
  if (!start || start.closest('[data-no-overflow-tooltip], [data-overflow-tooltip]')) return null;
  const host = start.closest(TOOLTIP_HOST_SELECTOR);
  const direct = start.closest<HTMLElement>(TRUNCATABLE_SELECTOR);
  const candidates: HTMLElement[] = [];
  if (direct && (!host || host.contains(direct))) candidates.push(direct);
  else if (host) candidates.push(...Array.from(host.querySelectorAll<HTMLElement>(TRUNCATABLE_SELECTOR)));
  for (const el of candidates) {
    if (el.closest('[aria-hidden="true"]') || hasNativeTooltip(el, host)) continue;
    if (isTextTruncated(el) && fullTextOf(el)) return el;
  }
  return null;
}

export interface PaneFit {
  explorer: number;
  chat: number;
}

/**
 * Fits the workspace side panes into the available width without changing what the user chose:
 * the chat gives way first, then the explorer, so the editor keeps `editorMin` pixels. When the
 * window grows again the saved widths come back.
 */
export function fitWorkspacePanes(
  available: number,
  wanted: PaneFit,
  visible: { explorer: boolean; chat: boolean },
  limits = { editorMin: 320, explorerMin: 160, chatMin: 300 }
): PaneFit {
  let explorer = visible.explorer ? wanted.explorer : 0;
  let chat = visible.chat ? wanted.chat : 0;
  if (!Number.isFinite(available) || available <= 0) return { explorer, chat };
  let excess = explorer + chat + limits.editorMin - available;
  if (excess > 0 && visible.chat) {
    const give = Math.min(excess, Math.max(0, chat - limits.chatMin));
    chat -= give;
    excess -= give;
  }
  if (excess > 0 && visible.explorer) {
    const give = Math.min(excess, Math.max(0, explorer - limits.explorerMin));
    explorer -= give;
  }
  return { explorer: Math.round(explorer), chat: Math.round(chat) };
}
