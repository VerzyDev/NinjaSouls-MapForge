import { it, expect, describe } from 'bun:test';

import {
  MapCustomZones,
  customZoneFocus,
  customZoneIdsAt,
  customZoneLabel,
  customZoneNames,
  toCustomZoneFile,
  customZoneTileKey,
  fromCustomZoneFile,
  withCustomZoneNames,
  paintCustomZoneFloors,
  withoutCustomZoneNames
} from './customZone';

const zonesWith = (tiles: [number, number, number][], minZ = 0, maxZ = 7): MapCustomZones => ({
  list: [{ id: 1, minZ, maxZ }],
  tiles: new Map(tiles.map(([x, y, floors]) => [customZoneTileKey(x, y), [{ id: 1, floors }]]))
});

const floor = (z: number) => 1 << z;

describe('customZoneFocus', () => {
  it('returns null for an unknown or empty zone', () => {
    expect(customZoneFocus(zonesWith([]), 1, 7)).toBeNull();
    expect(customZoneFocus(zonesWith([[10, 10, floor(7)]]), 2, 7)).toBeNull();
  });

  it('stays on the preferred floor when the zone has tiles there', () => {
    const zones = zonesWith([
      [10, 10, floor(6)],
      [20, 20, floor(6)],
      [30, 30, floor(7)]
    ]);
    expect(customZoneFocus(zones, 1, 7)).toEqual({ x: 30, y: 30, z: 7 });
  });

  it('falls back to the floor with the most tiles', () => {
    const zones = zonesWith([
      [10, 10, floor(5)],
      [11, 10, floor(5)],
      [30, 30, floor(6)]
    ]);
    expect(customZoneFocus(zones, 1, 7)?.z).toBe(5);
  });

  it('breaks floor ties by distance to the preferred floor', () => {
    const zones = zonesWith([
      [10, 10, floor(2)],
      [30, 30, floor(6)]
    ]);
    expect(customZoneFocus(zones, 1, 7)?.z).toBe(6);
  });

  it('lands on a zone tile near the center of a hollow zone', () => {
    const ring: [number, number, number][] = [];
    for (let i = 0; i <= 10; i++) {
      ring.push([i, 0, floor(7)], [i, 10, floor(7)], [0, i, floor(7)], [10, i, floor(7)]);
    }
    const focus = customZoneFocus(zonesWith(ring), 1, 7)!;
    expect(ring.some(([x, y]) => x === focus.x && y === focus.y)).toBe(true);
  });

  it('ignores tiles outside the zone range', () => {
    const zones = zonesWith([[10, 10, floor(9)]], 0, 7);
    expect(customZoneFocus(zones, 1, 9)).toBeNull();
  });
});

describe('paintCustomZoneFloors', () => {
  it('paints each floor only with its own tiles', () => {
    const zones = zonesWith([]);
    const next = paintCustomZoneFloors(zones, 1, [
      { z: 7, xs: [10, 11], ys: [10, 10] },
      { z: 6, xs: [10], ys: [10] }
    ])!;
    expect(customZoneIdsAt(next, 10, 10, 6)).toEqual([1]);
    expect(customZoneIdsAt(next, 11, 10, 7)).toEqual([1]);
    expect(customZoneIdsAt(next, 11, 10, 6)).toEqual([]);
  });

  it('returns null when no floor has tiles', () => {
    expect(paintCustomZoneFloors(zonesWith([]), 1, [{ z: 7, xs: [], ys: [] }])).toBeNull();
  });
});

describe('zone names', () => {
  const named: MapCustomZones = { list: [{ id: 1, name: 'Konoha', minZ: 0, maxZ: 7 }], tiles: new Map() };

  it('falls back to the id when the zone has no name', () => {
    expect(customZoneLabel({ id: 3 })).toBe('Zone 3');
    expect(customZoneLabel({ id: 3 }, 'Hunt zone')).toBe('Hunt zone 3');
    expect(customZoneLabel({ id: 3, name: 'Konoha' })).toBe('Konoha');
  });

  it('survives the file round trip used by hunt zones and undo', () => {
    expect(fromCustomZoneFile(toCustomZoneFile(named)).list[0].name).toBe('Konoha');
  });

  it('never reaches the server file', () => {
    expect(JSON.stringify(toCustomZoneFile(withoutCustomZoneNames(named)))).not.toContain('Konoha');
  });

  it('restores names from the separate names file', () => {
    const stripped = withoutCustomZoneNames(named);
    expect(withCustomZoneNames(stripped, customZoneNames(named)).list[0].name).toBe('Konoha');
  });

  it('ignores a malformed names file', () => {
    const stripped = withoutCustomZoneNames(named);
    expect(withCustomZoneNames(stripped, null)).toBe(stripped);
    expect(withCustomZoneNames(stripped, { 1: 42 }).list[0].name).toBeUndefined();
  });
});
