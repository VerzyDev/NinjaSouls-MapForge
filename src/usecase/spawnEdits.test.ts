import { test, expect } from 'bun:test';

import { buildMapSpawns, CreaturePlacement } from '~/domain/creature';

import { removeCreatures, removeCreaturesOnTiles } from './spawnEdits';

const creature = (x: number, y: number, z = 7, isNpc = false): CreaturePlacement => ({
  x,
  y,
  z,
  isNpc,
  name: isNpc ? 'Guide' : 'Rat',
  lookType: 21,
  head: 0,
  body: 0,
  legs: 0,
  feet: 0,
  spawntime: 60,
  direction: 2
});

test('erasing a lone creature also erases its spawn area', () => {
  const spawns = buildMapSpawns([{ x: 10, y: 10, z: 7, radius: 1 }], [creature(10, 10)]);
  const next = removeCreaturesOnTiles(spawns, 7, [10], [10]);
  expect(next.placements).toHaveLength(0);
  expect(next.areas).toHaveLength(0);
});

test('erasing an off-center creature erases the area it was the last one in', () => {
  const spawns = buildMapSpawns([{ x: 10, y: 10, z: 7, radius: 3 }], [creature(12, 11)]);
  expect(removeCreaturesOnTiles(spawns, 7, [12], [11]).areas).toHaveLength(0);
});

test('a spawn area still holding another creature survives', () => {
  const spawns = buildMapSpawns([{ x: 10, y: 10, z: 7, radius: 3 }], [creature(10, 10), creature(12, 12)]);
  const next = removeCreaturesOnTiles(spawns, 7, [10], [10]);
  expect(next.placements).toHaveLength(1);
  expect(next.areas).toHaveLength(1);
});

test('an npc keeps the spawn area alive', () => {
  const spawns = buildMapSpawns([{ x: 10, y: 10, z: 7, radius: 3 }], [creature(10, 10), creature(11, 11, 7, true)]);
  expect(removeCreaturesOnTiles(spawns, 7, [10], [10]).areas).toHaveLength(1);
});

test('a creature on another floor does not keep the area alive', () => {
  const spawns = buildMapSpawns([{ x: 10, y: 10, z: 7, radius: 3 }], [creature(10, 10), creature(10, 10, 6)]);
  const next = removeCreaturesOnTiles(spawns, 7, [10], [10]);
  expect(next.areas).toHaveLength(0);
  expect(next.placements).toHaveLength(1);
});

test('erasing on the center of an orphan area clears it', () => {
  const spawns = buildMapSpawns([{ x: 10, y: 10, z: 7, radius: 1 }], []);
  expect(removeCreaturesOnTiles(spawns, 7, [10], [10]).areas).toHaveLength(0);
});

test('dragging across an empty area without touching its center leaves it alone', () => {
  const spawns = buildMapSpawns([{ x: 10, y: 10, z: 7, radius: 3 }], []);
  expect(removeCreaturesOnTiles(spawns, 7, [11], [11])).toBe(spawns);
});

test('nothing to erase returns the same spawns', () => {
  const spawns = buildMapSpawns([{ x: 10, y: 10, z: 7, radius: 1 }], [creature(10, 10)]);
  expect(removeCreaturesOnTiles(spawns, 7, [50], [50])).toBe(spawns);
});

test('clearing a zone keeps npcs and sweeps empty areas inside it', () => {
  const inZone = (x: number) => x < 100;
  const spawns = buildMapSpawns(
    [
      { x: 10, y: 10, z: 7, radius: 1 },
      { x: 20, y: 20, z: 7, radius: 1 },
      { x: 30, y: 30, z: 7, radius: 1 },
      { x: 200, y: 200, z: 7, radius: 1 }
    ],
    [creature(10, 10), creature(20, 20, 7, true), creature(200, 200)]
  );
  const next = removeCreatures(
    spawns,
    (p) => !p.isNpc && inZone(p.x),
    (a) => inZone(a.x)
  );
  expect(next.placements.map((p) => p.x)).toEqual([20, 200]);
  expect(next.areas.map((a) => a.x)).toEqual([20, 200]);
});
