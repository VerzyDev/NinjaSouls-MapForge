import { test, expect } from 'bun:test';

import { CreaturePlacement } from '~/domain/creature';

import { isJsonText, jsonSidecarFile } from './sidecars';
import { parseHouseJson, serializeHouseJson } from './houseFile';
import { parseSpawnJson, serializeSpawnJson } from './spawnFile';
import { parseWaypointJson, serializeWaypointJson } from './waypointFile';

const creature = (name: string, x: number, y: number, z: number, isNpc = false): CreaturePlacement => ({
  name,
  x,
  y,
  z,
  isNpc,
  lookType: 0,
  head: 0,
  body: 0,
  legs: 0,
  feet: 0,
  spawntime: 60,
  direction: 2
});

test('jsonSidecarFile swaps xml for json and keeps json', () => {
  expect(jsonSidecarFile('souls-spawn.xml')).toBe('souls-spawn.json');
  expect(jsonSidecarFile('souls-house.json')).toBe('souls-house.json');
  expect(jsonSidecarFile('souls-spawn')).toBe('souls-spawn.json');
});

test('isJsonText tells json from xml', () => {
  expect(isJsonText('  {"spawns": []}')).toBe(true);
  expect(isJsonText('<?xml version="1.0"?><spawns/>')).toBe(false);
});

test('spawn json keeps absolute creature positions through a round trip', () => {
  const areas = [
    { x: 100, y: 100, z: 7, radius: 3 },
    { x: 50, y: 50, z: 6, radius: 5 }
  ];
  const placements = [creature('Rat', 102, 99, 7), creature('Oracle', 100, 100, 7, true), creature('Wolf', 300, 300, 7)];
  const text = serializeSpawnJson(areas, placements);
  const parsed = parseSpawnJson(text);
  expect(parsed.areas).toEqual([...areas, { x: 300, y: 300, z: 7, radius: 1 }]);
  expect(parsed.creatures.map((c) => [c.name, c.isNpc, c.x, c.y, c.z])).toEqual([
    ['Rat', false, 102, 99, 7],
    ['Oracle', true, 100, 100, 7],
    ['Wolf', false, 300, 300, 7]
  ]);
  expect(
    serializeSpawnJson(
      parsed.areas,
      parsed.creatures.map((c) => ({ ...creature(c.name, c.x, c.y, c.z, c.isNpc) }))
    )
  ).toBe(text);
});

test('empty spawn areas are kept without creature arrays', () => {
  const text = serializeSpawnJson([{ x: 1, y: 2, z: 7, radius: 5 }], []);
  expect(JSON.parse(text)).toEqual({ spawns: [{ x: 1, y: 2, z: 7, radius: 5 }] });
});

test('house json round trip writes size and only flags guildhalls', () => {
  const houses = [
    { id: 1, name: 'Casa', townId: 2, rent: 500, guildhall: false, entryX: 10, entryY: 11, entryZ: 7 },
    { id: 2, name: 'Cla', townId: 2, rent: 0, guildhall: true, entryX: 20, entryY: 21, entryZ: 6 }
  ];
  const text = serializeHouseJson(houses, { 1: 12 });
  const file = JSON.parse(text);
  expect(file.houses[0].size).toBe(12);
  expect(file.houses[0].guildhall).toBeUndefined();
  expect(file.houses[1].guildhall).toBe(true);
  expect(parseHouseJson(text)).toEqual(houses);
});

test('waypoint json round trip drops unnamed entries', () => {
  const waypoints = [{ name: 'Templo', x: 100, y: 200, z: 7 }];
  const text = serializeWaypointJson(waypoints);
  expect(parseWaypointJson(text)).toEqual(waypoints);
  expect(parseWaypointJson('{"waypoints":[{"name":"","x":1,"y":1,"z":7}]}')).toEqual([]);
});
