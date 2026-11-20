import type { Page } from '@playwright/test';

export interface LayoutIssue {
  kind: 'spill' | 'clipped' | 'wrapped' | 'page-scroll';
  text: string;
  where: string;
}

/**
 * Measures the rendered page: text that spills out of its box, text cut off without an ellipsis,
 * single-line controls whose label wrapped, and horizontal page scroll.
 * Multiline content (paragraphs, prose, editors, inputs, terminals) is skipped on purpose.
 */
export function auditLayout(page: Page): Promise<LayoutIssue[]> {
  return page.evaluate(() => {
    const issues: Array<{ kind: 'spill' | 'clipped' | 'wrapped' | 'page-scroll'; text: string; where: string }> = [];
    const SKIP = '.sr-only, textarea, input, pre, code, .prose-chat, .xterm, [data-multiline], svg, [aria-hidden="true"], [data-audit-skip], .cm-editor, [data-overflow-tooltip]';
    const SINGLE = 'button, [role="tab"], [role="option"], [role="menuitem"], th, td, h1, h2, h3, h4, a, kbd, .truncate, [data-truncate], .whitespace-nowrap, nav li';
    const describe = (el: Element) => {
      const parts: string[] = [];
      for (let node: Element | null = el; node && parts.length < 4; node = node.parentElement) {
        const label = node.getAttribute('aria-label') || node.getAttribute('role') || '';
        parts.push(node.tagName.toLowerCase() + (label ? `[${label}]` : ''));
      }
      return parts.join(' < ');
    };
    const visible = (el: Element) => {
      const style = getComputedStyle(el);
      return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05;
    };
    const seen = new Set<Element>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.textContent ?? '').trim();
      const el = node.parentElement;
      if (!text || !el || seen.has(el) || el.closest(SKIP) || !visible(el)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
      if (rects.length === 0) continue;
      const left = Math.min(...rects.map((r) => r.left));
      const right = Math.max(...rects.map((r) => r.right));
      const lines = new Set(rects.map((r) => Math.round(r.top))).size;
      if (lines > 1 && el.closest(SINGLE) && !el.closest('p')) {
        seen.add(el);
        issues.push({ kind: 'wrapped', text: text.slice(0, 60), where: describe(el) });
        continue;
      }
      for (let box: Element | null = el; box && box !== document.body; box = box.parentElement) {
        const style = getComputedStyle(box);
        const clips = style.overflowX !== 'visible';
        const r = box.getBoundingClientRect();
        if (r.width === 0) break;
        const out = right > r.right + 1.5 || left < r.left - 1.5;
        if (!out) {
          if (clips) break;
          continue;
        }
        if (clips) {
          const ellipsis = getComputedStyle(el).textOverflow === 'ellipsis' || style.textOverflow === 'ellipsis';
          const scrollable = style.overflowX === 'auto' || style.overflowX === 'scroll';
          if (!ellipsis && !scrollable) issues.push({ kind: 'clipped', text: text.slice(0, 60), where: describe(el) });
        } else if (box !== el && /^(BUTTON|TD|TH|LI|A|LABEL|SECTION|HEADER|ARTICLE|ASIDE|NAV|DIV)$/.test(box.tagName) && (getComputedStyle(box).borderLeftWidth !== '0px' || getComputedStyle(box).backgroundColor !== 'rgba(0, 0, 0, 0)')) {
          issues.push({ kind: 'spill', text: text.slice(0, 60), where: describe(el) });
        } else continue;
        seen.add(el);
        break;
      }
    }
    if (document.documentElement.scrollWidth > innerWidth + 1) issues.push({ kind: 'page-scroll', text: `${document.documentElement.scrollWidth}px`, where: 'document' });
    return issues;
  });
}

/** Widens every glyph, standing in for long names and longer translations without changing data. */
export async function stressText(page: Page, on: boolean): Promise<void> {
  await page.evaluate((enable) => {
    let style = document.getElementById('ahq-stress-text');
    if (!enable) return style?.remove();
    if (!style) {
      style = document.createElement('style');
      style.id = 'ahq-stress-text';
      style.textContent = 'body *:not(svg):not(svg *) { letter-spacing: 0.09em !important; }';
      document.head.appendChild(style);
    }
  }, on);
}
