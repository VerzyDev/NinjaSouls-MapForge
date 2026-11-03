import { test, expect } from 'bun:test';

import {
  Mask,
  fillBoxes,
  coverageMask,
  fillRotation,
  lureSegments,
  spreadPoints,
  createSpacing,
  scatterPoints,
  interleaveCounts
} from './hunt';

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

test('fillBoxes gives every box point its own boxSize monsters within view', () => {
  const m = filled(60, 40);
  const nodes = spreadPoints(m, 15, 11);
  const tiles = fillBoxes(m, nodes, 8, 7, 5, rng(5));
  const keys = new Set(tiles.map((t) => `${t.x},${t.y}`));
  expect(keys.size).toBe(tiles.length);
  nodes.forEach((n, box) => {
    const own = tiles.filter((t) => t.box === box);
    expect(own.length).toBe(8);
    for (const t of own) {
      expect(Math.abs(t.x - n.x)).toBeLessThanOrEqual(7);
      expect(Math.abs(t.y - n.y)).toBeLessThanOrEqual(5);
      expect(t.x === n.x && t.y === n.y).toBe(false);
    }
  });
});

test('fillBoxes fills small cells exhaustively and never crosses walls', () => {
  const m: Mask = Array.from({ length: 3 }, () => new Array(5).fill(false));
  for (let x = 0; x < 5; x++) m[1][x] = true;
  const tiles = fillBoxes(m, [{ x: 2, y: 1 }], 8, 7, 5, rng(9));
  expect(tiles.length).toBe(4);
  for (const t of tiles) expect(t.y).toBe(1);
});

test('fillBoxes does not reach tiles cut off by a wall', () => {
  const m = filled(20, 9);
  for (let y = 0; y < 9; y++) m[y][6] = false;
  const tiles = fillBoxes(m, [{ x: 3, y: 4 }], 40, 7, 5, rng(2));
  for (const t of tiles) expect(t.x).toBeLessThan(6);
});

test('interleaveCounts keeps exact counts and spreads each kind', () => {
  const seq = interleaveCounts([5, 3, 0]);
  expect(seq.length).toBe(8);
  expect(seq.filter((i) => i === 0).length).toBe(5);
  expect(seq.filter((i) => i === 1).length).toBe(3);
  expect(seq.includes(2)).toBe(false);
  expect(seq.slice(0, 2).sort()).toEqual([0, 1]);
  expect(interleaveCounts([])).toEqual([]);
});

test('box points get one screen each on open ground', () => {
  const m = filled(60, 44);
  const nodes = spreadPoints(m, 15, 11);
  expect(nodes.length).toBe(16);
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const apart = Math.abs(nodes[i].x - nodes[j].x) >= 15 || Math.abs(nodes[i].y - nodes[j].y) >= 11;
      expect(apart).toBe(true);
    }
  }
  const tiles = fillBoxes(m, nodes, 8, 7, 5, rng(4));
  expect(tiles.length).toBe(128);
});

test('spreadPoints skips screens with only a sliver of floor', () => {
  const m = filled(30, 11);
  for (let y = 0; y < 11; y++) for (let x = 15; x < 30; x++) m[y][x] = x === 15 && y < 3;
  expect(spreadPoints(m, 15, 11).length).toBe(1);
});

test('lureSegments splits a loop into even lures of about the lure length', () => {
  const seg = lureSegments(100, 21);
  expect(seg.length).toBe(100);
  expect(seg[0]).toBe(0);
  expect(seg[99]).toBe(4);
  const sizes = [0, 1, 2, 3, 4].map((k) => seg.filter((s) => s === k).length);
  for (const size of sizes) expect(size).toBe(20);
});

test('fillRotation gives every lure of the walk its own monsters near the path', () => {
  const m = filled(84, 11);
  const loop = Array.from({ length: 84 }, (_, x) => ({ x, y: 5 }));
  const { tiles, lures, targets } = fillRotation(m, loop, 8, 21, 10, 5, rng(6));
  expect(lures).toBe(4);
  expect(targets).toEqual([8, 8, 8, 8]);
  for (let lure = 0; lure < lures; lure++) expect(tiles.filter((t) => t.box === lure).length).toBe(8);
  for (const t of tiles) {
    const lureStart = t.box * 21;
    expect(t.x).toBeGreaterThanOrEqual(lureStart - 10);
    expect(t.x).toBeLessThanOrEqual(lureStart + 20 + 10);
  }
  expect(new Set(tiles.map((t) => `${t.x},${t.y}`)).size).toBe(tiles.length);
});

test('fillRotation scales monsters with the walk, so short loops stay sparse', () => {
  const room: Mask = Array.from({ length: 11 }, (_, y) => Array.from({ length: 30 }, (_, x) => x < 7 && y >= 4 && y <= 6));
  const short = Array.from({ length: 7 }, (_, x) => ({ x, y: 5 }));
  const small = fillRotation(room, short, 8, 21, 10, 5, rng(8));
  expect(small.lures).toBe(1);
  expect(small.tiles.length).toBe(3);

  const m = filled(30, 11);
  const loop = Array.from({ length: 30 }, (_, x) => ({ x, y: 5 }));
  const split = fillRotation(m, loop, 8, 21, 10, 5, rng(8));
  expect(split.lures).toBe(2);
  expect(split.targets).toEqual([6, 6]);
});

test('fillRotation counts the room area when the loop is a single standing spot', () => {
  const m = filled(10, 10);
  const { tiles } = fillRotation(m, [{ x: 5, y: 5 }], 8, 21, 10, 5, rng(2));
  expect(tiles.length).toBe(Math.round((8 * 100) / (21 * 11)));
});

const apart3 = (tiles: { x: number; y: number }[]) => {
  for (let i = 0; i < tiles.length; i++) {
    for (let j = i + 1; j < tiles.length; j++) {
      expect(Math.max(Math.abs(tiles[i].x - tiles[j].x), Math.abs(tiles[i].y - tiles[j].y))).toBeGreaterThanOrEqual(3);
    }
  }
};

test('spacing keeps every spawn square apart, even across lures', () => {
  const m = filled(84, 11);
  const loop = Array.from({ length: 84 }, (_, x) => ({ x, y: 5 }));
  const { tiles } = fillRotation(m, loop, 8, 21, 10, 5, rng(12), 0, createSpacing(m));
  expect(tiles.length).toBe(32);
  apart3(tiles);
});

test('spacing caps a crowded room instead of overlapping spawns', () => {
  const m = filled(6, 6);
  const sp = createSpacing(m);
  const pts = scatterPoints(m, 20, rng(3), sp);
  expect(pts.length).toBeLessThanOrEqual(4);
  apart3(pts);
});

test('a half-screen room gets about half a box', () => {
  const room: Mask = Array.from({ length: 11 }, (_, y) => Array.from({ length: 21 }, (_, x) => x < 11 && y < 11));
  const { tiles } = fillRotation(room, [{ x: 5, y: 5 }], 8, 30, 10, 5, rng(5));
  expect(tiles.length).toBe(Math.round((8 * 121) / 231));
});
