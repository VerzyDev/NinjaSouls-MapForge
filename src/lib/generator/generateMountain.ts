import { GenPlan } from '~/domain/biome';
import { MountainOptions, ResolvedMountain } from '~/domain/mountain';

import { fbm } from './noise';
import { key, Cell, NEIGHBOURS, components, LayerGroups } from './generate';

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function findFoot(comp: string[], upper: Set<string>, lower: Set<string>): Cell | null {
  for (const k of comp) {
    const [cx, cy] = k.split(',').map(Number);
    for (const [dx, dy] of NEIGHBOURS) {
      const nk = key(cx + dx, cy + dy);
      if (lower.has(nk) && !upper.has(nk)) return { x: cx + dx, y: cy + dy };
    }
  }
  return null;
}

export function mountainHeights(tiles: Cell[], opts: MountainOptions): Map<string, number> {
  const steps = Math.max(1, Math.floor(opts.steps));
  const threshold = clamp(1 - opts.density * 0.4, 0.05, 0.95);
  const span = 1 - threshold;
  const height = new Map<string, number>();
  for (const t of tiles) {
    const n = fbm(t.x * opts.scale, t.y * opts.scale, opts.seed);
    const h = n < threshold ? 0 : clamp(Math.ceil(((n - threshold) / span) * steps), 1, steps);
    height.set(key(t.x, t.y), h);
  }
  return height;
}

export function mountainMargin(heights: Map<string, number>, margin: number): Set<string> {
  const out = new Set<string>();
  for (const [k, h] of heights) {
    if (h < 1) continue;
    const [x, y] = k.split(',').map(Number);
    for (let dx = -margin; dx <= margin; dx++) {
      for (let dy = -margin; dy <= margin; dy++) out.add(key(x + dx, y + dy));
    }
  }
  return out;
}

export function planMountain(tiles: Cell[], mountain: ResolvedMountain, opts: MountainOptions, baseZ: number): GenPlan {
  const steps = Math.max(1, Math.floor(opts.steps));
  const height = mountainHeights(tiles, opts);

  const groups = new LayerGroups();
  for (const t of tiles) {
    const h = height.get(key(t.x, t.y))!;
    for (let k = 0; k < h; k++) groups.push(mountain.ground.serverId, true, false, mountain.ground.name, baseZ - k, t.x, t.y);
  }

  if (opts.stairs && mountain.stairs) {
    const floorRegion = (offset: number) => {
      const set = new Set<string>();
      for (const [kk, h] of height) if (h >= offset + 1) set.add(kk);
      return set;
    };
    for (let offset = 0; offset < steps - 1; offset++) {
      const lower = floorRegion(offset);
      const upper = floorRegion(offset + 1);
      for (const comp of components(upper, new Set())) {
        const foot = findFoot(comp, upper, lower);
        if (foot) {
          groups.push(
            mountain.stairs.serverId,
            mountain.stairs.isGround,
            mountain.stairs.isDoodad,
            mountain.stairs.name,
            baseZ - offset,
            foot.x,
            foot.y
          );
        }
      }
    }
  }

  return { layers: groups.layers() };
}
