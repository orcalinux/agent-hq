export const NODE_H = 96;
export const MIN_NODE_W = 170;
export const MAX_NODE_W = 250;
export const GAP_X = 24;
export const GAP_Y = 40;
export const MIN_TIER_GAP = 64;
export const CLEARANCE = 12;
const PAD = 28;

export interface LayoutInput {
  id: string;
  tier: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface GraphLayout {
  positions: Map<string, Point>;
  base: Map<string, Point>;
  nodeW: number;
  width: number;
  height: number;
}

interface Box {
  cx: number;
  cy: number;
}

function overlaps(a: Box, b: Box, w: number): boolean {
  return Math.abs(a.cx - b.cx) < w + CLEARANCE && Math.abs(a.cy - b.cy) < NODE_H + CLEARANCE;
}

/** Nearest position to `want` that keeps a clear gap around every card in `placed`. */
export function nearestFree(want: Point, placed: Box[], w: number): Point {
  const fits = (c: Box) => placed.every((p) => !overlaps(c, p, w));
  const start = { cx: want.x, cy: want.y };
  if (fits(start)) return want;
  const dx = w + CLEARANCE;
  const dy = NODE_H + CLEARANCE;
  const candidates: Box[] = [];
  for (const p of placed) {
    candidates.push(
      { cx: p.cx - dx, cy: want.y },
      { cx: p.cx + dx, cy: want.y },
      { cx: want.x, cy: p.cy - dy },
      { cx: want.x, cy: p.cy + dy },
      { cx: p.cx - dx, cy: p.cy },
      { cx: p.cx + dx, cy: p.cy },
      { cx: p.cx, cy: p.cy - dy },
      { cx: p.cx, cy: p.cy + dy },
    );
  }
  const rightmost = Math.max(...placed.map((p) => p.cx));
  candidates.push({ cx: rightmost + dx, cy: want.y });
  let best: Box | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = Math.hypot(c.cx - want.x, c.cy - want.y);
    if (d < bestDist && fits(c)) {
      best = c;
      bestDist = d;
    }
  }
  return { x: best!.cx, y: best!.cy };
}

/**
 * Lays agents out in tiers. A tier wider than the view wraps onto extra lines, and the canvas grows instead of
 * shrinking cards below MIN_NODE_W. Saved offsets are applied, then every card that would overlap another is moved
 * to the nearest free spot; the `pinnedLast` card (the one being dragged) is resolved last, so other cards never jump.
 */
export function layoutGraph(nodes: LayoutInput[], viewW: number, viewH: number, offsets: Record<string, Point>, pinnedLast?: string): GraphLayout {
  const tiers = [...new Set(nodes.map((n) => n.tier))].sort((a, b) => a - b).map((t) => nodes.filter((n) => n.tier === t));
  const widest = Math.max(1, ...tiers.map((t) => t.length));
  const cols = Math.max(1, Math.floor((viewW - GAP_X) / (MIN_NODE_W + GAP_X)));
  const perLine = Math.min(cols, widest);
  const nodeW = Math.max(MIN_NODE_W, Math.min(MAX_NODE_W, (viewW - GAP_X * (perLine + 1)) / perLine));
  const width = Math.max(viewW, perLine * nodeW + (perLine + 1) * GAP_X);

  const lines = tiers.map((t) => {
    const out: LayoutInput[][] = [];
    for (let i = 0; i < t.length; i += cols) out.push(t.slice(i, i + cols));
    return out;
  });
  const lineCount = lines.reduce((s, l) => s + l.length, 0);
  const natural = lineCount * NODE_H + (lineCount - tiers.length) * GAP_Y;
  const tierGap = tiers.length > 1 ? Math.max(MIN_TIER_GAP, (viewH - PAD * 2 - natural) / (tiers.length - 1)) : 0;

  const base = new Map<string, Point>();
  let y = PAD + NODE_H / 2;
  lines.forEach((tierLines) => {
    tierLines.forEach((line, li) => {
      if (li > 0) y += NODE_H + GAP_Y;
      const total = line.length * nodeW + (line.length - 1) * GAP_X;
      const left = (width - total) / 2 + nodeW / 2;
      line.forEach((n, i) => base.set(n.id, { x: left + i * (nodeW + GAP_X), y }));
    });
    y += NODE_H + tierGap;
  });

  const order = nodes.map((n) => n.id).filter((id) => id !== pinnedLast);
  if (pinnedLast && base.has(pinnedLast)) order.push(pinnedLast);
  const positions = new Map<string, Point>();
  const placed: Box[] = [];
  for (const id of order) {
    const b = base.get(id)!;
    const o = offsets[id];
    const p = nearestFree({ x: b.x + (o?.x ?? 0), y: b.y + (o?.y ?? 0) }, placed, nodeW);
    positions.set(id, p);
    placed.push({ cx: p.x, cy: p.y });
  }

  let right = width;
  let bottom = Math.max(viewH, y - tierGap - NODE_H / 2 + PAD);
  positions.forEach((p) => {
    right = Math.max(right, p.x + nodeW / 2 + PAD);
    bottom = Math.max(bottom, p.y + NODE_H / 2 + PAD);
  });
  return { positions, base, nodeW, width: right, height: bottom };
}
