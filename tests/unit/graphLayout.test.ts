import { describe, expect, it } from 'vitest';
import { CLEARANCE, NODE_H, layoutGraph } from '@/components/agents/graphLayout';

function assertNoOverlap(layout: ReturnType<typeof layoutGraph>) {
  const pts = [...layout.positions.values()];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const apart = Math.abs(pts[i].x - pts[j].x) >= layout.nodeW + CLEARANCE - 1e-6 || Math.abs(pts[i].y - pts[j].y) >= NODE_H + CLEARANCE - 1e-6;
      expect(apart, `cards ${i} and ${j} overlap`).toBe(true);
    }
  }
  for (const p of pts) {
    expect(p.x + layout.nodeW / 2).toBeLessThanOrEqual(layout.width);
    expect(p.y + NODE_H / 2).toBeLessThanOrEqual(layout.height);
  }
}

const team = (counts: number[]) => counts.flatMap((n, tier) => Array.from({ length: n }, (_, i) => ({ id: `t${tier}-${i}`, tier })));

describe('agent graph layout', () => {
  it('never overlaps cards for any team size or view size', () => {
    for (const counts of [[1, 1, 3, 2], [1, 1, 12, 30], [1, 0, 80, 0], [1, 2, 200, 150]]) {
      for (const [w, h] of [[360, 560], [640, 720], [1920, 1080]]) assertNoOverlap(layoutGraph(team(counts), w, h, {}));
    }
  });

  it('wraps a wide tier onto extra lines instead of shrinking cards', () => {
    const layout = layoutGraph(team([1, 0, 20]), 800, 560, {});
    expect(layout.nodeW).toBeGreaterThanOrEqual(170);
    expect(new Set([...layout.positions.values()].map((p) => p.y)).size).toBeGreaterThan(2);
    assertNoOverlap(layout);
  });

  it('moves a dragged card off others and leaves the others where they were', () => {
    const nodes = team([1, 1, 5, 2]);
    const plain = layoutGraph(nodes, 1200, 700, {});
    const target = plain.positions.get('t2-2')!;
    const start = plain.base.get('t3-0')!;
    const dragged = layoutGraph(nodes, 1200, 700, { 't3-0': { x: target.x - start.x, y: target.y - start.y } }, 't3-0');
    assertNoOverlap(dragged);
    for (const [id, p] of plain.positions) if (id !== 't3-0') expect(dragged.positions.get(id)).toEqual(p);
  });

  it('separates saved positions that collide, even when every card is stacked on one spot', () => {
    const nodes = team([1, 1, 6, 6]);
    const plain = layoutGraph(nodes, 1000, 600, {});
    const offsets = Object.fromEntries(nodes.map((n) => [n.id, { x: 500 - plain.base.get(n.id)!.x, y: 300 - plain.base.get(n.id)!.y }]));
    assertNoOverlap(layoutGraph(nodes, 1000, 600, offsets));
  });
});
