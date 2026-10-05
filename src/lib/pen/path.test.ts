import { test, expect } from 'bun:test';

import { TILE } from '~/components/MapCanvas/constants';

import { pathTiles, PenAnchor, sampleBezierPath } from './path';

const corner = (x: number, y: number): PenAnchor => ({
  p: { x, y },
  hIn: { x: 0, y: 0 },
  hOut: { x: 0, y: 0 }
});

function columnSpan(xs: number[], ys: number[]): Map<number, { min: number; max: number }> {
  const cols = new Map<number, { min: number; max: number }>();
  for (let i = 0; i < xs.length; i++) {
    const c = cols.get(xs[i]);
    if (!c) cols.set(xs[i], { min: ys[i], max: ys[i] });
    else {
      c.min = Math.min(c.min, ys[i]);
      c.max = Math.max(c.max, ys[i]);
    }
  }
  return cols;
}

test('a long straight drag is a continuous ribbon with no column gaps', () => {
  const pts = sampleBezierPath([corner(0, 0), corner(70 * TILE, 0)]);
  const xs = [...new Set(pathTiles(pts, 4, { seed: 5 }).xs)].sort((a, b) => a - b);
  let gaps = 0;
  for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] > 1) gaps++;
  expect(gaps).toBe(0);
});

test('ribbon thickness varies along its length', () => {
  const pts = sampleBezierPath([corner(0, 0), corner(70 * TILE, 0)]);
  const { xs, ys } = pathTiles(pts, 4, { seed: 5 });
  const heights = [...columnSpan(xs, ys).values()].map((c) => c.max - c.min);
  expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(1);
});

test('blobs have an irregular (non-flat) edge', () => {
  const pts = sampleBezierPath([corner(0, 0), corner(40 * TILE, 0)]);
  const { xs, ys } = pathTiles(pts, 4, { seed: 5 });
  const tops = new Set([...columnSpan(xs, ys).values()].map((c) => c.max));
  expect(tops.size).toBeGreaterThan(2);
});

test('wider stroke covers more tiles', () => {
  const pts = sampleBezierPath([corner(0, 0), corner(40 * TILE, 0)]);
  const thin = pathTiles(pts, 2, { seed: 1 }).xs.length;
  const thick = pathTiles(pts, 5, { seed: 1 }).xs.length;
  expect(thick).toBeGreaterThan(thin);
});

test('same seed is deterministic', () => {
  const pts = sampleBezierPath([corner(0, 0), corner(20 * TILE, 0)]);
  const a = pathTiles(pts, 3, { seed: 4 });
  const b = pathTiles(pts, 3, { seed: 4 });
  expect(a.xs.length).toBe(b.xs.length);
});

test('a handle bends the path off the straight line', () => {
  const a: PenAnchor = { p: { x: 0, y: 0 }, hIn: { x: 0, y: 0 }, hOut: { x: 0, y: 6 * TILE } };
  const b: PenAnchor = { p: { x: 10 * TILE, y: 0 }, hIn: { x: 0, y: 6 * TILE }, hOut: { x: 0, y: 0 } };
  const ys = new Set(pathTiles(sampleBezierPath([a, b]), 3, { seed: 2 }).ys);
  expect(ys.size).toBeGreaterThan(3);
});
