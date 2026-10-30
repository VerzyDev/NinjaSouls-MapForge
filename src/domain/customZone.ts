export interface CustomZone {
  id: number;
  color?: string;
  minZ: number;
  maxZ: number;
}

export interface CustomZoneTile {
  id: number;
  floors: number;
}

export interface MapCustomZones {
  list: CustomZone[];
  tiles: Map<number, CustomZoneTile[]>;
}

interface CustomZoneFloors {
  z?: number;
  excludeZ?: number[];
}

export interface CustomZoneArea extends CustomZoneFloors {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export interface CustomZonePosition extends CustomZoneFloors {
  x: number;
  y: number;
}

export interface CustomZoneFileEntry {
  id: number;
  color?: string;
  minZ?: number;
  maxZ?: number;
  areas: CustomZoneArea[];
  positions: CustomZonePosition[];
}

export interface CustomZoneFile {
  zone: CustomZoneFileEntry[];
}

export const MAX_CUSTOM_ZONE_ID = 65535;

export const CUSTOM_ZONE_FLOORS = 16;

export const ALL_CUSTOM_ZONE_FLOORS = (1 << CUSTOM_ZONE_FLOORS) - 1;

export const DEFAULT_CUSTOM_ZONE_RANGE = { minZ: 0, maxZ: 7 };

const XY = 65536;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const hslToHex = (h: number, s: number, l: number): string => {
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
};

export const defaultCustomZoneColor = (id: number): string => hslToHex((id * 137.508) % 360, 0.85, 0.58);

export const customZoneColor = (zone: Pick<CustomZone, 'color'> | undefined, id: number): string =>
  zone?.color && HEX_COLOR.test(zone.color) ? zone.color : defaultCustomZoneColor(id);

export const customZoneTileKey = (x: number, y: number) => y * XY + x;

const unpackTileKey = (key: number) => ({ x: key % XY, y: Math.floor(key / XY) });

const floorBit = (z: number) => 1 << z;

export const isValidCustomZoneFloor = (z: number) => Number.isInteger(z) && z >= 0 && z < CUSTOM_ZONE_FLOORS;

export const isValidCustomZoneRange = (minZ: number, maxZ: number) =>
  isValidCustomZoneFloor(minZ) && isValidCustomZoneFloor(maxZ) && minZ <= maxZ;

export const customZoneRangeMask = ({ minZ, maxZ }: Pick<CustomZone, 'minZ' | 'maxZ'>): number => {
  let mask = 0;
  for (let z = minZ; z <= maxZ; z++) mask |= floorBit(z);
  return mask;
};

export const customZoneRangeMasks = (zones: MapCustomZones): Map<number, number> =>
  new Map(zones.list.map((zone) => [zone.id, customZoneRangeMask(zone)]));

const effectiveFloors = (tile: CustomZoneTile, masks: Map<number, number>) => tile.floors & (masks.get(tile.id) ?? 0);

export const customZoneIdsOnFloor = (
  tiles: CustomZoneTile[] | undefined,
  z: number,
  masks: Map<number, number>
): number[] => {
  if (!tiles || !isValidCustomZoneFloor(z)) return [];
  const bit = floorBit(z);
  const ids: number[] = [];
  for (const tile of tiles) if (effectiveFloors(tile, masks) & bit) ids.push(tile.id);
  return ids;
};

export const customZoneIdsAt = (zones: MapCustomZones | null | undefined, x: number, y: number, z: number): number[] =>
  zones ? customZoneIdsOnFloor(zones.tiles.get(customZoneTileKey(x, y)), z, customZoneRangeMasks(zones)) : [];

export const emptyMapCustomZones = (): MapCustomZones => ({ list: [], tiles: new Map() });

export const sortCustomZones = (list: CustomZone[]): CustomZone[] => [...list].sort((a, b) => a.id - b.id);

export const nextCustomZoneId = (zones: MapCustomZones): number =>
  zones.list.reduce((max, zone) => Math.max(max, zone.id), 0) + 1;

export const customZoneById = (zones: MapCustomZones, id: number): CustomZone | undefined =>
  zones.list.find((zone) => zone.id === id);

const nextFloors = (current: number, z: number, set: boolean, allFloors: boolean): number => {
  if (allFloors) return set ? ALL_CUSTOM_ZONE_FLOORS : 0;
  return set ? current | floorBit(z) : current & ~floorBit(z);
};

function withoutFloors(entries: CustomZoneTile[], id: number, floors: number): CustomZoneTile[] {
  const result: CustomZoneTile[] = [];
  for (const entry of entries) {
    if (entry.id === id || !(entry.floors & floors)) result.push(entry);
    else if (entry.floors & ~floors) result.push({ id: entry.id, floors: entry.floors & ~floors });
  }
  return result;
}

export function paintCustomZone(
  zones: MapCustomZones,
  z: number,
  xs: number[],
  ys: number[],
  id: number,
  set: boolean,
  allFloors: boolean
): MapCustomZones | null {
  const zone = customZoneById(zones, id);
  if (!zone) return null;
  const range = customZoneRangeMask(zone);
  if (!allFloors && !(range & floorBit(z))) return null;
  let tiles: Map<number, CustomZoneTile[]> | null = null;
  for (let i = 0; i < xs.length; i++) {
    const key = customZoneTileKey(xs[i], ys[i]);
    const entries = (tiles ?? zones.tiles).get(key) ?? [];
    const own = entries.find((entry) => entry.id === id);
    const current = own?.floors ?? 0;
    const floors = nextFloors(current, z, set, allFloors);
    const claimed = floors & range & ~(current & range);
    const others = claimed ? withoutFloors(entries, id, claimed) : entries;
    if (floors === current && others === entries) continue;
    tiles ??= new Map(zones.tiles);
    const rest = others.filter((entry) => entry.id !== id);
    if (floors) rest.push({ id, floors });
    if (rest.length) tiles.set(key, rest);
    else tiles.delete(key);
  }
  return tiles ? { list: zones.list, tiles } : null;
}

export function removeCustomZone(zones: MapCustomZones, id: number): MapCustomZones {
  const tiles = new Map<number, CustomZoneTile[]>();
  for (const [key, entries] of zones.tiles) {
    const rest = entries.some((entry) => entry.id === id) ? entries.filter((entry) => entry.id !== id) : entries;
    if (rest.length) tiles.set(key, rest);
  }
  return { list: zones.list.filter((zone) => zone.id !== id), tiles };
}

export function updateCustomZone(zones: MapCustomZones, previousId: number, next: CustomZone): MapCustomZones {
  const list = zones.list.map((zone) => (zone.id === previousId ? next : zone));
  const masks = customZoneRangeMasks({ list, tiles: zones.tiles });
  const tiles = new Map<number, CustomZoneTile[]>();
  for (const [key, entries] of zones.tiles) {
    if (!entries.some((entry) => entry.id === previousId)) {
      tiles.set(key, entries);
      continue;
    }
    let taken = 0;
    for (const entry of entries) if (entry.id !== previousId) taken |= effectiveFloors(entry, masks);
    const rest: CustomZoneTile[] = [];
    for (const entry of entries) {
      if (entry.id !== previousId) rest.push(entry);
      else if (entry.floors & ~taken) rest.push({ id: next.id, floors: entry.floors & ~taken });
    }
    if (rest.length) tiles.set(key, rest);
  }
  return { list, tiles };
}

export function customZoneTileCounts(zones: MapCustomZones): Map<number, number> {
  const masks = customZoneRangeMasks(zones);
  const counts = new Map<number, number>();
  for (const entries of zones.tiles.values()) {
    for (const entry of entries) if (effectiveFloors(entry, masks)) counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1);
  }
  return counts;
}

const floorsToFile = (floors: number): CustomZoneFloors => {
  if (floors === ALL_CUSTOM_ZONE_FLOORS) return {};
  const included: number[] = [];
  const excluded: number[] = [];
  for (let z = 0; z < CUSTOM_ZONE_FLOORS; z++) (floors & floorBit(z) ? included : excluded).push(z);
  return included.length === 1 ? { z: included[0] } : { excludeZ: excluded };
};

function packFloorTiles(keys: number[], floors: number, areas: CustomZoneArea[], positions: CustomZonePosition[]) {
  const remaining = new Set(keys);
  const sorted = [...keys].sort((a, b) => a - b);
  const fileFloors = floorsToFile(floors);
  for (const start of sorted) {
    if (!remaining.has(start)) continue;
    const { x, y } = unpackTileKey(start);
    let w = 1;
    while (x + w < XY && remaining.has(customZoneTileKey(x + w, y))) w++;
    let h = 1;
    for (; y + h < XY; h++) {
      let full = true;
      for (let dx = 0; dx < w; dx++) {
        if (!remaining.has(customZoneTileKey(x + dx, y + h))) {
          full = false;
          break;
        }
      }
      if (!full) break;
    }
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) remaining.delete(customZoneTileKey(x + dx, y + dy));
    }
    if (w === 1 && h === 1) positions.push({ x, y, ...fileFloors });
    else areas.push({ fromX: x, fromY: y, toX: x + w - 1, toY: y + h - 1, ...fileFloors });
  }
}

function packZoneTiles(keysByFloors: Map<number, number[]>): { areas: CustomZoneArea[]; positions: CustomZonePosition[] } {
  const areas: CustomZoneArea[] = [];
  const positions: CustomZonePosition[] = [];
  const masks = [...keysByFloors.keys()].sort((a, b) => b - a);
  for (const floors of masks) packFloorTiles(keysByFloors.get(floors)!, floors, areas, positions);
  return { areas, positions };
}

export function toCustomZoneFile(zones: MapCustomZones): CustomZoneFile {
  const keysById = new Map<number, Map<number, number[]>>();
  for (const [key, entries] of zones.tiles) {
    for (const { id, floors } of entries) {
      let byFloors = keysById.get(id);
      if (!byFloors) keysById.set(id, (byFloors = new Map()));
      const keys = byFloors.get(floors);
      if (keys) keys.push(key);
      else byFloors.set(floors, [key]);
    }
  }
  return {
    zone: sortCustomZones(zones.list).map((zone) => ({
      id: zone.id,
      ...(zone.color ? { color: zone.color } : {}),
      minZ: zone.minZ,
      maxZ: zone.maxZ,
      ...packZoneTiles(keysById.get(zone.id) ?? new Map())
    }))
  };
}

const int = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;

const floorsFromFile = (data: Partial<CustomZoneFloors> | null | undefined): number => {
  if (data && 'z' in data) {
    const z = data.z;
    return typeof z === 'number' && isValidCustomZoneFloor(z) ? floorBit(z) : 0;
  }
  let floors = ALL_CUSTOM_ZONE_FLOORS;
  for (const z of Array.isArray(data?.excludeZ) ? data.excludeZ : []) {
    if (typeof z === 'number' && isValidCustomZoneFloor(z)) floors &= ~floorBit(z);
  }
  return floors;
};

export function fromCustomZoneFile(file: Partial<CustomZoneFile> | null | undefined): MapCustomZones {
  const zones = emptyMapCustomZones();
  const seen = new Set<number>();
  const ranges = new Map<number, number>();
  const add = (x: number, y: number, floors: number, id: number) => {
    if (!floors || x < 0 || y < 0 || x >= XY || y >= XY) return;
    const key = customZoneTileKey(x, y);
    const entries = zones.tiles.get(key);
    let taken = 0;
    for (const other of entries ?? []) if (other.id !== id) taken |= effectiveFloors(other, ranges);
    const kept = floors & ~taken;
    if (!kept) return;
    const entry = entries?.find((other) => other.id === id);
    if (entry) entry.floors |= kept;
    else if (entries) entries.push({ id, floors: kept });
    else zones.tiles.set(key, [{ id, floors: kept }]);
  };
  for (const entry of Array.isArray(file?.zone) ? file.zone : []) {
    const id = int(entry?.id);
    if (id <= 0 || id > MAX_CUSTOM_ZONE_ID || seen.has(id)) continue;
    const minZ = int(entry.minZ, 0);
    const maxZ = int(entry.maxZ, CUSTOM_ZONE_FLOORS - 1);
    if (!isValidCustomZoneRange(minZ, maxZ)) continue;
    seen.add(id);
    const color = typeof entry.color === 'string' && HEX_COLOR.test(entry.color) ? entry.color.toLowerCase() : undefined;
    const zone: CustomZone = color ? { id, color, minZ, maxZ } : { id, minZ, maxZ };
    zones.list.push(zone);
    ranges.set(id, customZoneRangeMask(zone));
    for (const a of Array.isArray(entry.areas) ? entry.areas : []) {
      const floors = floorsFromFile(a);
      if (!floors) continue;
      const minX = Math.min(int(a?.fromX), int(a?.toX, int(a?.fromX)));
      const maxX = Math.max(int(a?.fromX), int(a?.toX, int(a?.fromX)));
      const minY = Math.min(int(a?.fromY), int(a?.toY, int(a?.fromY)));
      const maxY = Math.max(int(a?.fromY), int(a?.toY, int(a?.fromY)));
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) add(x, y, floors, id);
      }
    }
    for (const p of Array.isArray(entry.positions) ? entry.positions : [])
      add(int(p?.x), int(p?.y), floorsFromFile(p), id);
  }
  return zones;
}

export const MAX_CUSTOM_ZONE_FILL = 4_000_000;

export interface CustomZoneTileList {
  xs: number[];
  ys: number[];
}

export function customZoneTilesOnFloor(zones: MapCustomZones, id: number, z: number): CustomZoneTileList {
  const zone = customZoneById(zones, id);
  const xs: number[] = [];
  const ys: number[] = [];
  if (!zone || !isValidCustomZoneFloor(z)) return { xs, ys };
  const bit = customZoneRangeMask(zone) & floorBit(z);
  if (!bit) return { xs, ys };
  for (const [key, entries] of zones.tiles) {
    if (entries.some((entry) => entry.id === id && entry.floors & bit)) {
      const { x, y } = unpackTileKey(key);
      xs.push(x);
      ys.push(y);
    }
  }
  return { xs, ys };
}

export function connectedCustomZoneTiles(
  zones: MapCustomZones,
  id: number,
  z: number,
  x: number,
  y: number
): CustomZoneTileList {
  const xs: number[] = [];
  const ys: number[] = [];
  const has = (tx: number, ty: number) =>
    tx >= 0 && ty >= 0 && tx < XY && ty < XY && customZoneIdsAt(zones, tx, ty, z).includes(id);
  if (!has(x, y)) return { xs, ys };
  const seen = new Set<number>([customZoneTileKey(x, y)]);
  const queue: number[] = [x, y];
  while (queue.length) {
    const ty = queue.pop()!;
    const tx = queue.pop()!;
    xs.push(tx);
    ys.push(ty);
    for (const [dx, dy] of [
      [0, -1],
      [-1, 0],
      [1, 0],
      [0, 1]
    ]) {
      const nx = tx + dx;
      const ny = ty + dy;
      const key = customZoneTileKey(nx, ny);
      if (seen.has(key) || !has(nx, ny)) continue;
      seen.add(key);
      queue.push(nx, ny);
    }
  }
  return { xs, ys };
}

export function polygonTiles(points: { x: number; y: number }[]): CustomZoneTileList | null {
  const xs: number[] = [];
  const ys: number[] = [];
  if (points.length < 3) return { xs, ys };
  const minX = Math.min(...points.map((p) => p.x));
  const maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));
  if ((maxX - minX + 1) * (maxY - minY + 1) > MAX_CUSTOM_ZONE_FILL) return null;

  const w = maxX - minX + 1;
  const inside = new Uint8Array(w * (maxY - minY + 1));
  const mark = (x: number, y: number) => (inside[(y - minY) * w + (x - minX)] = 1);

  for (let y = minY; y <= maxY; y++) {
    const cy = y + 0.5;
    const crossings: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const ay = a.y + 0.5;
      const by = b.y + 0.5;
      if (ay === by || cy < Math.min(ay, by) || cy >= Math.max(ay, by)) continue;
      crossings.push(a.x + 0.5 + ((cy - ay) * (b.x - a.x)) / (by - ay));
    }
    crossings.sort((p, q) => p - q);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const from = Math.max(minX, Math.ceil(crossings[i] - 0.5));
      const to = Math.min(maxX, Math.floor(crossings[i + 1] - 0.5));
      for (let x = from; x <= to; x++) mark(x, y);
    }
  }

  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), 1);
    for (let s = 0; s <= steps; s++) {
      mark(Math.round(a.x + ((b.x - a.x) * s) / steps), Math.round(a.y + ((b.y - a.y) * s) / steps));
    }
  }

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (inside[(y - minY) * w + (x - minX)]) {
        xs.push(x);
        ys.push(y);
      }
    }
  }
  return { xs, ys };
}
