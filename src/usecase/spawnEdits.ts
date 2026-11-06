import { Position } from '~/domain/map';
import { MapSpawns, SpawnArea, buildMapSpawns, CreaturePlacement } from '~/domain/creature';

export interface CreatureLookInput {
  name: string;
  isNpc: boolean;
  lookType: number;
  head: number;
  body: number;
  legs: number;
  feet: number;
}

const covers = (a: SpawnArea, x: number, y: number, z: number): boolean =>
  a.z === z && Math.max(Math.abs(a.x - x), Math.abs(a.y - y)) <= a.radius;

const samePos = (p: { x: number; y: number; z: number }, pos: Position): boolean =>
  p.x === pos.x && p.y === pos.y && p.z === pos.z;

export function placeCreature(
  spawns: MapSpawns,
  pos: Position,
  look: CreatureLookInput,
  spawntime: number,
  radius: number,
  autoSpawn: boolean
): MapSpawns {
  const covered = spawns.areas.some((a) => covers(a, pos.x, pos.y, pos.z));
  if (!covered && !autoSpawn) return spawns;
  const placements = spawns.placements.filter((p) => !samePos(p, pos));
  placements.push({
    x: pos.x,
    y: pos.y,
    z: pos.z,
    name: look.name,
    isNpc: look.isNpc,
    lookType: look.lookType,
    head: look.head,
    body: look.body,
    legs: look.legs,
    feet: look.feet,
    spawntime,
    direction: 2
  });
  const areas = covered ? spawns.areas : [...spawns.areas, { x: pos.x, y: pos.y, z: pos.z, radius: Math.max(1, radius) }];
  return buildMapSpawns(areas, placements);
}

export function removeCreatureAt(spawns: MapSpawns, pos: Position): MapSpawns {
  return buildMapSpawns(
    spawns.areas,
    spawns.placements.filter((p) => !samePos(p, pos))
  );
}

export function removeCreatures(
  spawns: MapSpawns,
  doomed: (p: CreaturePlacement) => boolean,
  sweepEmpty: (a: SpawnArea) => boolean = () => false
): MapSpawns {
  const removed = spawns.placements.filter(doomed);
  const placements = spawns.placements.filter((p) => !doomed(p));
  const areas = spawns.areas.filter((a) => {
    const removable = sweepEmpty(a) || removed.some((p) => covers(a, p.x, p.y, p.z));
    return !removable || placements.some((p) => covers(a, p.x, p.y, p.z));
  });
  if (removed.length === 0 && areas.length === spawns.areas.length) return spawns;
  return buildMapSpawns(areas, placements);
}

export function removeCreaturesOnTiles(spawns: MapSpawns, z: number, xs: number[], ys: number[]): MapSpawns {
  const tiles = new Set(xs.map((x, i) => `${x},${ys[i]}`));
  const onTiles = (p: { x: number; y: number; z: number }) => p.z === z && tiles.has(`${p.x},${p.y}`);
  return removeCreatures(spawns, onTiles, onTiles);
}

export function moveCreature(spawns: MapSpawns, from: Position, to: Position): MapSpawns {
  const placements = spawns.placements.map((p) => (samePos(p, from) ? { ...p, x: to.x, y: to.y, z: to.z } : p));
  return buildMapSpawns(spawns.areas, placements);
}

export function updateCreature(spawns: MapSpawns, pos: Position, spawntime: number, direction: number): MapSpawns {
  const placements = spawns.placements.map((p) => (samePos(p, pos) ? { ...p, spawntime, direction } : p));
  return buildMapSpawns(spawns.areas, placements);
}

export function placeSpawn(spawns: MapSpawns, pos: Position, radius: number): MapSpawns {
  if (spawns.areas.some((a) => samePos(a, pos))) return spawns;
  return buildMapSpawns([...spawns.areas, { x: pos.x, y: pos.y, z: pos.z, radius: Math.max(1, radius) }], spawns.placements);
}

export function removeSpawnAt(spawns: MapSpawns, pos: Position): MapSpawns {
  return buildMapSpawns(
    spawns.areas.filter((a) => !samePos(a, pos)),
    spawns.placements
  );
}

export function moveSpawn(spawns: MapSpawns, from: Position, to: Position): MapSpawns {
  const areas = spawns.areas.map((a) => (samePos(a, from) ? { ...a, x: to.x, y: to.y, z: to.z } : a));
  return buildMapSpawns(areas, spawns.placements);
}

export function setSpawnSize(spawns: MapSpawns, pos: Position, radius: number): MapSpawns {
  const areas = spawns.areas.map((a) => (samePos(a, pos) ? { ...a, radius: Math.max(1, radius) } : a));
  return buildMapSpawns(areas, spawns.placements);
}

export function updateSpawn(spawns: MapSpawns, center: Position, radius: number, spawntime: number): MapSpawns {
  const r = Math.max(1, radius);
  const areas = spawns.areas.map((a) => (samePos(a, center) ? { ...a, radius: r } : a));
  const area: SpawnArea = { x: center.x, y: center.y, z: center.z, radius: r };
  const placements = spawns.placements.map((p) => (covers(area, p.x, p.y, p.z) ? { ...p, spawntime } : p));
  return buildMapSpawns(areas, placements);
}
