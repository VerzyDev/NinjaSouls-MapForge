import { test, expect } from 'bun:test';

import { Thing } from '~/domain/thing';
import { ChunkTiles } from '~/domain/map';

import { isWalkableTile } from './mask';

const GROUND = 1;
const WALL = 2;
const AVOID = 3;
const STAIRS_FLAG = 4;
const LADDER = 5;

const items = new Map<number, Thing>([
  [GROUND, { isGround: true } as Thing],
  [WALL, { isUnpassable: true } as Thing],
  [AVOID, { blockPathfind: true } as Thing],
  [STAIRS_FLAG, { floorChange: true } as Thing],
  [LADDER, {} as Thing]
]);

const tile = (...ids: number[]) =>
  ({ itemOffset: [0, ids.length], clientIds: ids, serverIds: ids }) as unknown as ChunkTiles;

test('a bare ground tile is walkable', () => {
  expect(isWalkableTile(tile(GROUND), 0, items)).toBe(true);
});

test('a tile without ground is not walkable', () => {
  expect(isWalkableTile(tile(LADDER), 0, items)).toBe(false);
});

test('blocked, avoided and floor change items make the tile not walkable', () => {
  expect(isWalkableTile(tile(GROUND, WALL), 0, items)).toBe(false);
  expect(isWalkableTile(tile(GROUND, AVOID), 0, items)).toBe(false);
  expect(isWalkableTile(tile(GROUND, STAIRS_FLAG), 0, items)).toBe(false);
});

test('server floor change ids make the tile not walkable', () => {
  expect(isWalkableTile(tile(GROUND, LADDER), 0, items)).toBe(true);
  expect(isWalkableTile(tile(GROUND, LADDER), 0, items, new Set([LADDER]))).toBe(false);
});
