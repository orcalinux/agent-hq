import { describe, expect, it } from 'vitest';
import { fitWorkspacePanes, placeOverflowTooltip } from '../../src/utils/overflow';

const viewport = { width: 1024, height: 640 };
const box = (left: number, top: number, width = 120, height = 18) => ({ left, top, right: left + width, bottom: top + height, width, height });

describe('overflow tooltip placement', () => {
  it('opens below the text, aligned to its start edge', () => {
    expect(placeOverflowTooltip(box(100, 100), { width: 200, height: 30 }, viewport)).toEqual({ left: 100, top: 124, side: 'below' });
  });

  it('flips above when there is no room below', () => {
    const placed = placeOverflowTooltip(box(100, 600), { width: 200, height: 30 }, viewport);
    expect(placed.side).toBe('above');
    expect(placed.top + 30).toBeLessThanOrEqual(600);
  });

  it('stays inside the viewport at the right edge and for very wide text', () => {
    expect(placeOverflowTooltip(box(980, 100), { width: 300, height: 30 }, viewport).left + 300).toBeLessThanOrEqual(viewport.width);
    expect(placeOverflowTooltip(box(0, 100), { width: 2000, height: 30 }, viewport).left).toBeGreaterThanOrEqual(0);
  });

  it('aligns to the end edge in right-to-left layouts', () => {
    expect(placeOverflowTooltip(box(500, 100, 200), { width: 100, height: 30 }, viewport, true).left).toBe(600);
  });
});

describe('workspace pane fitting', () => {
  const wanted = { explorer: 260, chat: 420 };
  const both = { explorer: true, chat: true };

  it('keeps the saved widths when they fit', () => {
    expect(fitWorkspacePanes(1600, wanted, both)).toEqual(wanted);
  });

  it('shrinks the chat before the explorer so the editor keeps its minimum', () => {
    expect(fitWorkspacePanes(900, wanted, both)).toEqual({ explorer: 260, chat: 320 });
    expect(fitWorkspacePanes(760, wanted, both)).toEqual({ explorer: 160, chat: 300 });
  });

  it('never goes below the pane minimums', () => {
    expect(fitWorkspacePanes(300, wanted, both)).toEqual({ explorer: 160, chat: 300 });
  });

  it('ignores hidden panes and unmeasured containers', () => {
    expect(fitWorkspacePanes(900, wanted, { explorer: false, chat: true })).toEqual({ explorer: 0, chat: 420 });
    expect(fitWorkspacePanes(0, wanted, both)).toEqual(wanted);
  });
});
