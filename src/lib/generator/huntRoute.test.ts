import { test, expect } from 'bun:test';

import { Mask } from './hunt';
import { buildRoute, reachableFrom } from './huntRoute';

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
