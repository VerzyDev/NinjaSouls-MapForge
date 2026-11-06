import { test, expect } from 'bun:test';

import { buildLoops } from './huntRoute';
import {
  Mask,
  LureRules,
  fillBoxes,
  fillLures,
  findRooms,
  roomTarget,
  nodePerRoom,
  coverageMask,
  spreadPoints,
  stopsPulling,
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

const apart3 = (tiles: { x: number; y: number }[]) => {
  for (let i = 0; i < tiles.length; i++) {
    for (let j = i + 1; j < tiles.length; j++) {
      expect(Math.max(Math.abs(tiles[i].x - tiles[j].x), Math.abs(tiles[i].y - tiles[j].y))).toBeGreaterThanOrEqual(3);
    }
  }
};

function roomsMask(w: number, h: number, rects: [number, number, number, number][]): Mask {
  const m: Mask = Array.from({ length: h }, () => new Array(w).fill(false));
  for (const [x, y, rw, rh] of rects) for (let j = y; j < y + rh; j++) for (let i = x; i < x + rw; i++) m[j][i] = true;
  return m;
}

const NEIGHBOUR_ROOMS: [number, number, number, number][] = [
  [0, 0, 10, 10],
  [14, 0, 10, 10]
];

test('findRooms splits rooms joined by a narrow passage', () => {
  const m = roomsMask(24, 10, [...NEIGHBOUR_ROOMS, [10, 4, 4, 2]]);
  const rooms = findRooms(m);
  expect(rooms.length).toBe(2);
  expect(rooms.flat().every((p) => m[p.y][p.x])).toBe(true);
});

test('findRooms keeps a hall with pillars as one room', () => {
  const m = filled(40, 30);
  for (let y = 3; y < 30; y += 5) for (let x = 3; x < 40; x += 5) m[y][x] = false;
  const rooms = findRooms(m);
  expect(rooms.length).toBe(1);
  expect(rooms[0].every((p) => m[p.y][p.x])).toBe(true);
});

test('roomTarget grows with the room and stops at a full lure', () => {
  expect(roomTarget(9, 8)).toBe(0);
  expect(roomTarget(25, 8)).toBe(2);
  expect(roomTarget(64, 8)).toBe(4);
  expect(roomTarget(100, 8)).toBe(6);
  expect(roomTarget(144, 8)).toBe(8);
  expect(roomTarget(5000, 8)).toBe(8);
  expect(roomTarget(100, 16)).toBe(13);
});

const LURE: LureRules = { perLure: 8, lureLength: 21, aggroW: 25, aggroH: 15 };

const worstLure = (m: Mask, loops: { x: number; y: number }[][], tiles: { x: number; y: number }[], rules = LURE) => {
  let worst = 0;
  const pulled = tiles.map((t) => stopsPulling(m, loops, t, rules.aggroW, rules.aggroH));
  loops.forEach((path, loop) => {
    const span = Math.min(rules.lureLength, path.length);
    for (let start = 0; start < path.length; start++) {
      const walked = new Set(Array.from({ length: span }, (_, i) => (start + i) % path.length));
      const count = pulled.filter((stops) => stops.some((s) => s.loop === loop && walked.has(s.index))).length;
      worst = Math.max(worst, count);
    }
  });
  return worst;
};

const walkLoop = (m: Mask, nodes: { x: number; y: number }[]) => buildLoops(m, nodes).map((l) => l.path);

test('walking any stretch of the route never pulls more than one lure', () => {
  const m = filled(120, 60);
  const loops = walkLoop(m, spreadPoints(m, 21, 11));
  const { tiles } = fillLures(m, loops, LURE, rng(1));
  expect(tiles.length).toBeGreaterThan(30);
  expect(worstLure(m, loops, tiles)).toBe(8);
  apart3(tiles);
});

test('neighbour rooms share the lure when the route crosses both in one stretch', () => {
  const m = roomsMask(24, 10, [...NEIGHBOUR_ROOMS, [10, 4, 4, 2]]);
  const loops = walkLoop(m, [
    { x: 5, y: 5 },
    { x: 18, y: 5 }
  ]);
  const { tiles } = fillLures(m, loops, LURE, rng(2));
  expect(worstLure(m, loops, tiles)).toBeLessThanOrEqual(8);
  expect(tiles.length).toBeGreaterThanOrEqual(6);
});

test('a longer route between rooms lets each room fill to its size', () => {
  const m = roomsMask(70, 10, [
    [0, 0, 10, 10],
    [50, 0, 10, 10],
    [10, 4, 40, 2]
  ]);
  const loops = walkLoop(m, [
    { x: 5, y: 5 },
    { x: 55, y: 5 }
  ]);
  const { tiles } = fillLures(m, loops, LURE, rng(3));
  expect(tiles.filter((t) => t.x < 10).length).toBe(6);
  expect(tiles.filter((t) => t.x >= 50).length).toBe(6);
  expect(worstLure(m, loops, tiles)).toBeLessThanOrEqual(8);
});

test('a wall with no path nearby keeps monsters out of the lure', () => {
  const m = roomsMask(40, 21, [
    [0, 0, 40, 10],
    [0, 11, 40, 10]
  ]);
  const stops = stopsPulling(m, [[{ x: 20, y: 5 }]], { x: 20, y: 13 }, 25, 15);
  expect(stops.length).toBe(0);
  expect(stopsPulling(filled(40, 21), [[{ x: 20, y: 5 }]], { x: 20, y: 11 }, 25, 15).length).toBe(1);
});

test('rooms along a street leave part of every lure to the street', () => {
  const rects: [number, number, number, number][] = [[0, 12, 120, 12]];
  for (let x = 0; x < 120; x += 12) rects.push([x, 0, 11, 11], [x + 5, 11, 2, 1]);
  const m = roomsMask(120, 24, rects);
  const nodes = [...Array.from({ length: 10 }, (_, i) => ({ x: i * 12 + 5, y: 5 })), { x: 60, y: 18 }];
  const loops = walkLoop(m, nodes);
  const { tiles } = fillLures(m, loops, LURE, rng(7));
  expect(tiles.filter((t) => t.y >= 12).length).toBeGreaterThanOrEqual(8);
  expect(tiles.filter((t) => t.y < 11).length).toBeGreaterThanOrEqual(10);
  expect(worstLure(m, loops, tiles)).toBeLessThanOrEqual(8);
});

test('nothing spawns where the route cannot pull it', () => {
  const m = filled(120, 20);
  const loops = [[{ x: 5, y: 10 }]];
  const { tiles } = fillLures(m, loops, LURE, rng(4));
  expect(tiles.length).toBeGreaterThan(0);
  expect(tiles.every((t) => t.x <= 17)).toBe(true);
});

test('a small room stays at its size target', () => {
  const m = filled(7, 7);
  const { tiles, lures } = fillLures(m, [[{ x: 3, y: 3 }]], LURE, rng(5));
  expect(tiles.length).toBe(3);
  expect(lures).toBe(1);
});

test('lures are numbered along the route', () => {
  const m = filled(120, 15);
  const loops = walkLoop(m, [
    { x: 2, y: 7 },
    { x: 117, y: 7 }
  ]);
  const { tiles, lures } = fillLures(m, loops, LURE, rng(6));
  expect(lures).toBe(Math.ceil(tiles.length / 8));
  expect(tiles.filter((t) => t.box === 0).length).toBe(8);
});

test('nodePerRoom gives every room off the route a point inside it', () => {
  const m = roomsMask(24, 10, [...NEIGHBOUR_ROOMS, [10, 4, 4, 2]]);
  const nodes = nodePerRoom(m, [{ x: 5, y: 5 }]);
  expect(nodes.length).toBe(2);
  expect(nodes[1].x).toBeGreaterThanOrEqual(14);
  expect(nodePerRoom(m, nodes).length).toBe(2);
});

test('spacing caps a crowded room instead of overlapping spawns', () => {
  const m = filled(6, 6);
  const sp = createSpacing(m);
  const pts = scatterPoints(m, 20, rng(3), sp);
  expect(pts.length).toBeLessThanOrEqual(4);
  apart3(pts);
});
