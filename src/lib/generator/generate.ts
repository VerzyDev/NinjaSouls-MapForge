import { GenPlan, GenLayer, ResolvedRef, ResolvedBiome, ResolvedLayer, GenerateOptions } from '~/domain/biome';

import { fbm, hash01 } from './noise';

export interface Cell {
  x: number;
  y: number;
}

export const key = (x: number, y: number) => `${x},${y}`;

export type ProgressFn = (done: number, total: number) => void;

const planYield = (): Promise<void> =>
  new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
export const NEIGHBOURS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1]
];

export class LayerGroups {
  private groups = new Map<string, GenLayer>();

  push(serverId: number, isGround: boolean, isDoodad: boolean, brush: string, z: number, x: number, y: number): void {
    const gk = `${serverId},${z},${isGround ? 1 : 0},${isDoodad ? 1 : 0},${brush}`;
    let group = this.groups.get(gk);
    if (!group) {
      group = { serverId, isGround, isDoodad, brush, z, xs: [], ys: [] };
      this.groups.set(gk, group);
    }
    group.xs.push(x);
    group.ys.push(y);
  }

  layers(): GenLayer[] {
    return [...this.groups.values()];
  }
}

const CLUMP_SCALE = 0.06;
const CLUMP_THRESHOLD = 0.58;
const LINE_DIRS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1]
];

function breakRuns(placed: Map<string, ResolvedLayer>): void {
  const snapshot = new Map(placed);
  for (const [k, layer] of snapshot) {
    const [x, y] = k.split(',').map(Number);
    const id = layer.ref.serverId;
    for (const [dx, dy] of LINE_DIRS) {
      const a = snapshot.get(key(x - dx, y - dy));
      const b = snapshot.get(key(x - 2 * dx, y - 2 * dy));
      if (a && b && a.ref.serverId === id && b.ref.serverId === id) {
        placed.delete(k);
        break;
      }
    }
  }
}

export function components(region: Set<string>, blocked: Set<string>): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const k of region) {
    if (blocked.has(k) || seen.has(k)) continue;
    const comp: string[] = [];
    const stack = [k];
    seen.add(k);
    while (stack.length) {
      const cur = stack.pop()!;
      comp.push(cur);
      const [cx, cy] = cur.split(',').map(Number);
      for (const [dx, dy] of NEIGHBOURS) {
        const nk = key(cx + dx, cy + dy);
        if (region.has(nk) && !blocked.has(nk) && !seen.has(nk)) {
          seen.add(nk);
          stack.push(nk);
        }
      }
    }
    out.push(comp);
  }
  return out;
}

function carvePathToMain(region: Set<string>, blocked: Set<string>, comp: string[], main: Set<string>): string[] {
  const start = new Set<string>();
  for (const k of comp) {
    const [cx, cy] = k.split(',').map(Number);
    for (const [dx, dy] of NEIGHBOURS) {
      const nk = key(cx + dx, cy + dy);
      if (blocked.has(nk)) start.add(nk);
    }
  }
  const parent = new Map<string, string | null>();
  const queue: string[] = [];
  for (const s of start) {
    parent.set(s, null);
    queue.push(s);
  }
  const adjacentToMain = (k: string): boolean => {
    const [cx, cy] = k.split(',').map(Number);
    return NEIGHBOURS.some(([dx, dy]) => main.has(key(cx + dx, cy + dy)));
  };
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    if (adjacentToMain(cur)) {
      const path: string[] = [];
      let node: string | null = cur;
      while (node) {
        path.push(node);
        node = parent.get(node) ?? null;
      }
      return path;
    }
    const [cx, cy] = cur.split(',').map(Number);
    for (const [dx, dy] of NEIGHBOURS) {
      const nk = key(cx + dx, cy + dy);
      if (region.has(nk) && blocked.has(nk) && !parent.has(nk)) {
        parent.set(nk, cur);
        queue.push(nk);
      }
    }
  }
  return [];
}

export function ensureConnected(region: Set<string>, blocked: Set<string>, onClear: (k: string) => void): void {
  let comps = components(region, blocked);
  let guard = 0;
  while (comps.length > 1 && guard++ < region.size) {
    comps.sort((a, b) => b.length - a.length);
    const main = new Set(comps[0]);
    const target = comps[1];
    const path = carvePathToMain(region, blocked, target, main);
    if (path.length === 0) {
      for (const k of target) main.add(k);
    } else {
      for (const k of path) {
        blocked.delete(k);
        onClear(k);
      }
    }
    comps = components(region, blocked);
  }
}

const BLOTCH_SCALE = 0.18;

function blotchRefAt(biome: ResolvedBiome, x: number, y: number, seed: number): ResolvedRef | null {
  for (let i = 0; i < biome.blotches.length; i++) {
    const b = biome.blotches[i];
    const threshold = 0.8 - Math.max(0, Math.min(1, b.intensity)) * 0.4;
    const scale = BLOTCH_SCALE * (1 + (i % 3) * 0.25);
    if (fbm(x * scale, y * scale, seed + 4242 + i * 1597, 2) > threshold) return b.ref;
  }
  return null;
}

const SQUARE_CORNERS = [
  [0, 0],
  [-1, 0],
  [0, -1],
  [-1, -1]
];

function inFullSquare(set: Set<string>, x: number, y: number): boolean {
  for (const [ox, oy] of SQUARE_CORNERS) {
    if (
      set.has(key(x + ox, y + oy)) &&
      set.has(key(x + ox + 1, y + oy)) &&
      set.has(key(x + ox, y + oy + 1)) &&
      set.has(key(x + ox + 1, y + oy + 1))
    ) {
      return true;
    }
  }
  return false;
}

export function pruneThinBlotches(blotchAt: Map<string, ResolvedRef>): void {
  const byRef = new Map<number, Set<string>>();
  for (const [k, ref] of blotchAt) {
    let s = byRef.get(ref.serverId);
    if (!s) {
      s = new Set();
      byRef.set(ref.serverId, s);
    }
    s.add(k);
  }
  const remove: string[] = [];
  for (const [k, ref] of blotchAt) {
    const [x, y] = k.split(',').map(Number);
    if (!inFullSquare(byRef.get(ref.serverId)!, x, y)) remove.push(k);
  }
  for (const k of remove) blotchAt.delete(k);
}

function biomeSelector(biomes: ResolvedBiome[], opts: GenerateOptions): (x: number, y: number) => ResolvedBiome {
  if (biomes.length === 1) return () => biomes[0];
  return (x, y) => {
    let best = 0;
    let bestV = -Infinity;
    for (let i = 0; i < biomes.length; i++) {
      const v = fbm(x * opts.biomeScale, y * opts.biomeScale, opts.seed + 1009 + i * 5003, 2);
      if (v > bestV) {
        bestV = v;
        best = i;
      }
    }
    return biomes[best];
  };
}

function rollLayers(
  x: number,
  y: number,
  layers: ResolvedLayer[],
  density: number,
  seed: number,
  chanceSalt: number
): ResolvedLayer | null {
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    if (layer.cluster) {
      const clump = fbm(x * CLUMP_SCALE, y * CLUMP_SCALE, seed + (i + 1) * 7919, 2);
      if (clump < CLUMP_THRESHOLD) continue;
    }
    const p = (layer.chance / 100) * density;
    if (hash01(x, y, seed + (i + 1) * chanceSalt) < p) return layer;
  }
  return null;
}

const PLAN_BATCH = 16384;

export async function planGeneration(
  tiles: Cell[],
  biomes: ResolvedBiome[],
  opts: GenerateOptions,
  z: number,
  onProgress?: ProgressFn,
  excludeScatter?: Set<string>
): Promise<GenPlan> {
  if (biomes.length === 0) return { layers: [] };
  const region = new Set<string>();
  for (const t of tiles) region.add(key(t.x, t.y));

  const biomeAt = biomeSelector(biomes, opts);
  const biomeOf = biomes.length === 1 ? null : tiles.map((t) => biomeAt(t.x, t.y));
  const at = (i: number) => (biomeOf ? biomeOf[i] : biomes[0]);

  const splitCache = new Map<ResolvedBiome, { highs: ResolvedLayer[]; lows: ResolvedLayer[] }>();
  const split = (b: ResolvedBiome) => {
    let c = splitCache.get(b);
    if (!c) {
      c = { highs: b.scatters.filter((s) => s.layer === 'high'), lows: b.scatters.filter((s) => s.layer === 'low') };
      splitCache.set(b, c);
    }
    return c;
  };

  const total = tiles.length * 3;
  let done = 0;
  const step = async () => {
    done += PLAN_BATCH;
    onProgress?.(Math.min(done, total), total);
    await planYield();
  };

  const excluded = (k: string) => excludeScatter?.has(k) ?? false;

  const highAt = new Map<string, ResolvedLayer>();
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    const k = key(t.x, t.y);
    if (excluded(k)) {
      if (i % PLAN_BATCH === PLAN_BATCH - 1) await step();
      continue;
    }
    const hit = rollLayers(t.x, t.y, split(at(i)).highs, opts.density, opts.seed, 131);
    if (hit) highAt.set(k, hit);
    if (i % PLAN_BATCH === PLAN_BATCH - 1) await step();
  }
  breakRuns(highAt);

  const blocked = new Set<string>(highAt.keys());
  ensureConnected(region, blocked, (k) => highAt.delete(k));

  const blotchAt = new Map<string, ResolvedRef>();
  if (opts.blotches) {
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      const ref = blotchRefAt(at(i), t.x, t.y, opts.seed);
      if (ref) blotchAt.set(key(t.x, t.y), ref);
    }
    pruneThinBlotches(blotchAt);
  }
  for (const k of blotchAt.keys()) highAt.delete(k);

  const lowAt = new Map<string, ResolvedLayer>();
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    const k = key(t.x, t.y);
    if (!highAt.has(k) && !blotchAt.has(k) && !excluded(k)) {
      const hit = rollLayers(t.x, t.y, split(at(i)).lows, opts.density, opts.seed + 5077, 977);
      if (hit) lowAt.set(k, hit);
    }
    if (i % PLAN_BATCH === PLAN_BATCH - 1) await step();
  }

  const groups = new LayerGroups();
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    const g = blotchAt.get(key(t.x, t.y)) ?? at(i).ground;
    groups.push(g.serverId, true, false, g.name, z, t.x, t.y);
    if (i % PLAN_BATCH === PLAN_BATCH - 1) await step();
  }
  for (const map of [highAt, lowAt]) {
    for (const [k, layer] of map) {
      const [x, y] = k.split(',').map(Number);
      groups.push(layer.ref.serverId, false, layer.ref.isDoodad, layer.ref.name, z, x, y);
    }
  }

  onProgress?.(total, total);
  return { layers: groups.layers() };
}
