import { test, expect } from 'bun:test';

import { Mask } from './hunt';
import { buildLoops, buildRoute, nodePerArea, reachableFrom, keepMainAreas } from './huntRoute';

function grid(rows: string[]): Mask {
  return rows.map((r) => r.split('').map((c) => c === '#'));
}

test('edges follow a walkable corridor, not a straight line', () => {
  const m = grid(['###', '..#', '###']);
  const route = buildRoute(m, [
    { x: 0, y: 0 },
    { x: 0, y: 2 }
  ]);
  expect(route.edges.length).toBe(1);
  for (const p of route.edges[0].path) expect(m[p.y][p.x]).toBe(true);
  expect(route.edges[0].path[0]).toEqual({ x: 0, y: 0 });
  expect(route.edges[0].path[route.edges[0].path.length - 1]).toEqual({ x: 0, y: 2 });
  expect(route.edges[0].path.length).toBeGreaterThan(3);
});

test('diagonal move is blocked when both orthogonals are walls', () => {
  const m = grid(['#.', '.#']);
  const route = buildRoute(m, [
    { x: 0, y: 0 },
    { x: 1, y: 1 }
  ]);
  expect(route.edges.length).toBe(0);
});

test('keeps only the largest reachable component and drops islands', () => {
  const m = grid(['###.#', '###..']);
  const route = buildRoute(m, [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 1, y: 1 },
    { x: 4, y: 0 }
  ]);
  expect(route.nodes.length).toBe(3);
  expect(route.edges.length).toBe(2);
  expect(route.nodes).not.toContainEqual({ x: 4, y: 0 });
});

test('two isolated singletons collapse to one node, no edges', () => {
  const m = grid(['#.#']);
  const route = buildRoute(m, [
    { x: 0, y: 0 },
    { x: 2, y: 0 }
  ]);
  expect(route.nodes.length).toBe(1);
  expect(route.edges.length).toBe(0);
});

test('reachableFrom excludes disconnected pockets', () => {
  const m = grid(['##.##', '##.##']);
  const r = reachableFrom(m, { x: 0, y: 0 });
  expect(r[0][0]).toBe(true);
  expect(r[1][1]).toBe(true);
  expect(r[0][3]).toBe(false);
  expect(r[1][4]).toBe(false);
});

test('three connected nodes form a two-edge tree', () => {
  const m = grid(['#####', '#####', '#####']);
  const route = buildRoute(m, [
    { x: 1, y: 1 },
    { x: 3, y: 1 },
    { x: 2, y: 2 }
  ]);
  expect(route.nodes.length).toBe(3);
  expect(route.edges.length).toBe(2);
});

test('keepMainAreas drops a pocket cut off by a tree but keeps the hall', () => {
  const walk = grid(['#####.##', '#####.##', '#####.##']);
  const area = grid(['########', '########', '########']);
  const { mask, dropped } = keepMainAreas(walk, area, 10);
  expect(dropped).toBe(1);
  expect(mask[0][0]).toBe(true);
  expect(mask[0][6]).toBe(false);
  expect(mask[0][5]).toBe(false);
});

test('keepMainAreas joins zone parts linked by walkable tiles outside the zone', () => {
  const walk = grid(['#######', '#######']);
  const area = grid(['##...##', '##...##']);
  const { mask, dropped } = keepMainAreas(walk, area, 10);
  expect(dropped).toBe(0);
  expect(mask[0][6]).toBe(true);
});

test('buildLoops closes a walkable loop through every point', () => {
  const m = grid(['##########', '##########', '##########']);
  const nodes = [
    { x: 0, y: 1 },
    { x: 9, y: 1 },
    { x: 5, y: 0 }
  ];
  const loops = buildLoops(m, nodes);
  expect(loops.length).toBe(1);
  const path = loops[0].path;
  for (const n of nodes) expect(path.some((p) => p.x === n.x && p.y === n.y)).toBe(true);
  const first = path[0];
  const last = path[path.length - 1];
  expect(Math.max(Math.abs(first.x - last.x), Math.abs(first.y - last.y))).toBeLessThanOrEqual(1);
  for (let i = 1; i < path.length; i++) {
    expect(Math.max(Math.abs(path[i].x - path[i - 1].x), Math.abs(path[i].y - path[i - 1].y))).toBe(1);
  }
});

test('buildLoops makes one loop per disconnected area', () => {
  const m = grid(['###..###']);
  const loops = buildLoops(m, [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 7, y: 0 }
  ]);
  expect(loops.length).toBe(2);
  expect(loops[1].path).toEqual([{ x: 7, y: 0 }]);
});

test('keepMainAreas keeps a small room reached by stairs from another floor', () => {
  const walk = grid(['#####.###', '#####.###']);
  const area = grid(['#####.###', '#####.###']);
  const stairs = grid(['.......#.', '.........']);
  const { mask, dropped } = keepMainAreas(walk, area, 10, stairs);
  expect(dropped).toBe(0);
  expect(mask[0][8]).toBe(true);
  expect(keepMainAreas(walk, area, 10).dropped).toBe(1);
});

test('nodePerArea adds a centred point to every area that has none', () => {
  const m = grid(['###...#####', '###...#####', '###...#####']);
  const nodes = nodePerArea(m, [{ x: 1, y: 1 }]);
  expect(nodes.length).toBe(2);
  expect(nodes[1]).toEqual({ x: 8, y: 1 });
  expect(nodePerArea(m, nodes).length).toBe(2);
});
