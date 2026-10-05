import { test, expect } from 'bun:test';

import { Mask, coverageMask, spreadPoints, scatterPoints } from './hunt';

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function filled(w: number, h: number): Mask {
  return Array.from({ length: h }, () => new Array(w).fill(true));
}

test('spreadPoints keeps view overlap at most a third on every axis pair', () => {
  const m = filled(40, 30);
  const pts = spreadPoints(m, 15, 11);
  expect(pts.length).toBeGreaterThan(1);
  for (const p of pts) expect(m[p.y][p.x]).toBe(true);
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const tooClose = Math.abs(pts[i].x - pts[j].x) < 10 && Math.abs(pts[i].y - pts[j].y) < 7;
      expect(tooClose).toBe(false);
    }
  }
});

test('spreadPoints covers the area - every walkable tile is within a point view', () => {
  const m = filled(30, 22);
  const pts = spreadPoints(m, 15, 11);
  for (let y = 0; y < 22; y++) {
    for (let x = 0; x < 30; x++) {
      const covered = pts.some((p) => Math.abs(p.x - x) < 15 && Math.abs(p.y - y) < 11);
      expect(covered).toBe(true);
    }
  }
});

test('scatterPoints places count walkable points evenly spread', () => {
  const m = filled(30, 30);
  const pts = scatterPoints(m, 20, rng(7));
  expect(pts.length).toBe(20);
  for (const p of pts) expect(m[p.y][p.x]).toBe(true);
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      expect(Math.max(Math.abs(pts[i].x - pts[j].x), Math.abs(pts[i].y - pts[j].y))).toBeGreaterThanOrEqual(2);
    }
  }
});

test('scatterPoints spreads across the whole area, no large empty region', () => {
  const m = filled(40, 40);
  const pts = scatterPoints(m, 16, rng(11));
  for (let qy = 0; qy < 2; qy++) {
    for (let qx = 0; qx < 2; qx++) {
      const inQuad = pts.filter((p) => p.x >= qx * 20 && p.x < (qx + 1) * 20 && p.y >= qy * 20 && p.y < (qy + 1) * 20);
      expect(inQuad.length).toBeGreaterThanOrEqual(2);
    }
  }
});

test('coverageMask marks only walkable tiles within the half-view rect of cover points', () => {
  const m = filled(30, 30);
  m[5][5] = false;
  const cov = coverageMask(m, [{ x: 5, y: 5 }], 3, 2);
  expect(cov[5][5]).toBe(false);
  expect(cov[5][8]).toBe(true);
  expect(cov[7][5]).toBe(true);
  expect(cov[5][9]).toBe(false);
  expect(cov[8][5]).toBe(false);
  expect(cov[20][20]).toBe(false);
});

test('scatterPoints never places on blocked tiles', () => {
  const m = filled(10, 10);
  for (let x = 0; x < 10; x++) m[5][x] = false;
  const pts = scatterPoints(m, 15, rng(3));
  for (const p of pts) expect(p.y).not.toBe(5);
});

test('spreadPoints skips blocked tiles', () => {
  const m: Mask = filled(20, 20);
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) m[y][x] = false;
  m[10][10] = true;
  expect(spreadPoints(m, 15, 11)).toEqual([{ x: 10, y: 10 }]);
});
