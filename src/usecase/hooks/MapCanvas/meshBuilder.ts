import { Thing } from '~/domain/thing';
import { slotUV } from '~/usecase/glRenderer';
import { LoadedSprite } from '~/domain/sprite';
import { ChunkTiles, PreviewTile } from '~/domain/map';
import { SpawnArea, CreaturePlacement } from '~/domain/creature';
import { isColorized, OutfitColors, colorizeOutfit } from '~/domain/outfit';
import { TILE, CHUNK, MAX_ELEVATION } from '~/components/MapCanvas/constants';
import { ThingType, isCountStack, isFluidThing, getSpriteIndex, stackSpriteIndex, fluidSpriteIndex } from '~/domain/tibia';

import { SpriteAtlas } from './useSpriteAtlas';
import { ChunkTilesCache } from './useChunkTiles';

const SPAWN_FACTORS = [179, 125, 88, 61, 43, 30, 21, 15, 10];

export const spawnTileKey = (x: number, y: number) => x * 100000 + y;

export function spawnFactor(count: number): number {
  return SPAWN_FACTORS[Math.min(count, 9) - 1] / 256;
}

export function spawnCountsForChunk(areas: SpawnArea[], cx: number, cy: number): Map<number, number> {
  const counts = new Map<number, number>();
  const minX = cx * CHUNK;
  const minY = cy * CHUNK;
  const maxX = minX + CHUNK - 1;
  const maxY = minY + CHUNK - 1;
  for (const a of areas) {
    const x0 = Math.max(minX, a.x - a.radius);
    const x1 = Math.min(maxX, a.x + a.radius);
    const y0 = Math.max(minY, a.y - a.radius);
    const y1 = Math.min(maxY, a.y + a.radius);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const k = spawnTileKey(x, y);
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
  }
  return counts;
}

export interface MeshContext {
  items: Map<number, Thing>;
  tiles: ChunkTilesCache;
  atlas: SpriteAtlas;
}

export interface EmitOptions {
  x: number;
  y: number;
  atlas: SpriteAtlas;
  tick: number;
  missing?: Set<number>;
  seen?: Set<number>;
  count?: number;
  pattern?: boolean;
  elevation?: number;
  shiftX?: number;
  shiftY?: number;
  tint?: number;
  factor?: number;
}

export function emitThing(inst: number[], thing: Thing, o: EmitOptions): boolean {
  const { x, y, atlas, tick } = o;
  const usePattern = o.pattern !== false;
  const px = usePattern && !thing.hangable && thing.patternX > 0 ? x % thing.patternX : 0;
  const py = usePattern && thing.patternY > 0 ? y % thing.patternY : 0;
  const count = o.count;
  const countStack = count != null && isCountStack(thing);
  const fluid = count != null && !countStack && isFluidThing(thing);
  const frameIdx = countStack ? stackSpriteIndex(thing, count) : fluid ? fluidSpriteIndex(thing, count) : 0;
  const elevation = o.elevation ?? 0;
  const ox = (thing.offsetX || 0) + elevation - (o.shiftX ?? 0);
  const oy = (thing.offsetY || 0) + elevation - (o.shiftY ?? 0);
  const tint = o.tint ?? 0;
  const factor = o.factor ?? 1;
  let complete = true;

  for (let l = 0; l < thing.layers; l++) {
    for (let h = 0; h < thing.height; h++) {
      for (let w = 0; w < thing.width; w++) {
        const sid = thing.spriteIndex[countStack || fluid ? frameIdx : getSpriteIndex(thing, w, h, l, px, py, 0, 0)];
        if (!sid) continue;
        const data = atlas.data.current.get(sid);
        if (!data) {
          o.missing?.add(sid);
          complete = false;
          continue;
        }
        atlas.lastUsed.current.set(sid, tick);
        o.seen?.add(sid);
        if (data.empty) continue;
        const slot = atlas.slotFor(sid, data);
        if (slot < 0) {
          complete = false;
          continue;
        }
        const { u0, v0 } = slotUV(slot);
        inst.push((x - w) * TILE - ox, (y - h) * TILE - oy, u0, v0, tint, factor, 0);
      }
    }
  }

  return complete;
}

export function stackElevation(current: number, thing: Thing): number {
  return thing.hasElevation ? Math.min(current + thing.elevation, MAX_ELEVATION) : current;
}

function findTileIndex(ct: ChunkTiles, tx: number, ty: number): number {
  for (let i = 0; i < ct.tileX.length; i++) {
    if (ct.tileX[i] === tx && ct.tileY[i] === ty) return i;
  }
  return -1;
}

type OutfitResolve = { id: number; data: LoadedSprite } | null | 'incomplete';

function resolveOutfitSprite(
  thing: ThingType,
  w: number,
  h: number,
  dir: number,
  colors: OutfitColors,
  atlas: SpriteAtlas,
  missing: Set<number>
): OutfitResolve {
  const baseSid = thing.spriteIndex[getSpriteIndex(thing, w, h, 0, dir, 0, 0, 0)];
  if (!baseSid) return null;
  if (thing.layers < 2 || !isColorized(colors)) {
    const data = atlas.data.current.get(baseSid);
    if (!data) {
      missing.add(baseSid);
      return 'incomplete';
    }
    return { id: baseSid, data };
  }

  const cid = atlas.compositeId(`${baseSid}:${colors.head}:${colors.body}:${colors.legs}:${colors.feet}`);
  const cached = atlas.data.current.get(cid);
  if (cached) return { id: cid, data: cached };

  const base = atlas.data.current.get(baseSid);
  if (!base) {
    missing.add(baseSid);
    return 'incomplete';
  }
  const maskSid = thing.spriteIndex[getSpriteIndex(thing, w, h, 1, dir, 0, 0, 0)];
  if (!maskSid) return { id: baseSid, data: base };
  const mask = atlas.data.current.get(maskSid);
  if (!mask) {
    missing.add(maskSid);
    return 'incomplete';
  }
  if (base.empty || mask.empty) return { id: baseSid, data: base };

  const composite: LoadedSprite = { id: cid, empty: false, rgba: colorizeOutfit(base.rgba, mask.rgba, colors) };
  atlas.data.current.set(cid, composite);
  return { id: cid, data: composite };
}

export function appendCreatures(
  inst: number[],
  placements: CreaturePlacement[],
  outfits: Map<number, ThingType>,
  atlas: SpriteAtlas,
  tick: number,
  missing: Set<number>,
  selected = false
): boolean {
  const tint = selected ? 1 : 0;
  let complete = true;
  for (const c of placements) {
    if (!c.lookType) continue;
    const thing = outfits.get(c.lookType);
    if (!thing || thing.spriteIndex.length === 0) continue;
    const dir = Math.min(Math.max(0, c.direction), Math.max(0, thing.patternX - 1));
    const ox = thing.offsetX || 0;
    const oy = thing.offsetY || 0;
    const colors: OutfitColors = { head: c.head, body: c.body, legs: c.legs, feet: c.feet };
    for (let h = 0; h < thing.height; h++) {
      for (let w = 0; w < thing.width; w++) {
        const res = resolveOutfitSprite(thing, w, h, dir, colors, atlas, missing);
        if (res === 'incomplete') {
          complete = false;
          continue;
        }
        if (!res) continue;
        atlas.lastUsed.current.set(res.id, tick);
        if (res.data.empty) continue;
        const slot = atlas.slotFor(res.id, res.data);
        if (slot < 0) {
          complete = false;
          continue;
        }
        const { u0, v0 } = slotUV(slot);
        inst.push((c.x - w) * TILE - ox, (c.y - h) * TILE - oy, u0, v0, tint, 1, 0);
      }
    }
  }
  return complete;
}

export function buildCreatureGhost(
  lookType: number,
  x: number,
  y: number,
  z: number,
  outfits: Map<number, ThingType>,
  atlas: SpriteAtlas,
  tick: number,
  missing: Set<number>,
  colors: OutfitColors = { head: 0, body: 0, legs: 0, feet: 0 }
): Float32Array | null {
  if (!lookType) return null;
  const inst: number[] = [];
  appendCreatures(
    inst,
    [{ x, y, z, name: '', isNpc: false, lookType, ...colors, spawntime: 0, direction: 2 }],
    outfits,
    atlas,
    tick,
    missing
  );
  return inst.length > 0 ? new Float32Array(inst) : null;
}

export function buildSpawnAreaGhost(
  ctx: MeshContext,
  centerX: number,
  centerY: number,
  z: number,
  radius: number,
  tick: number,
  missing: Set<number>
): Float32Array | null {
  const { items, tiles, atlas } = ctx;
  const factor = spawnFactor(1);
  const inst: number[] = [];
  for (let ty = centerY - radius; ty <= centerY + radius; ty++) {
    for (let tx = centerX - radius; tx <= centerX + radius; tx++) {
      const ct = tiles.get(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK), z, tick);
      if (!ct) continue;
      const found = findTileIndex(ct, tx, ty);
      if (found < 0) continue;
      const end = ct.itemOffset[found + 1];
      for (let ii = ct.itemOffset[found]; ii < end; ii++) {
        const thing = items.get(ct.clientIds[ii]);
        if (!thing || thing.spriteIndex.length === 0 || (!thing.isGround && !thing.isGroundBorder)) continue;
        emitThing(inst, thing, { x: tx, y: ty, atlas, tick, missing, factor });
      }
    }
  }
  return inst.length > 0 ? new Float32Array(inst) : null;
}

export function buildThingGhost(
  thing: Thing,
  x: number,
  y: number,
  atlas: SpriteAtlas,
  tick: number,
  missing: Set<number>
): Float32Array | null {
  const inst: number[] = [];
  emitThing(inst, thing, { x, y, atlas, tick, missing, pattern: false });
  return inst.length > 0 ? new Float32Array(inst) : null;
}

export interface ClipboardGhostTile {
  dx: number;
  dy: number;
  dz: number;
  items: { clientId: number; count: number }[];
}

export function buildClipboardGhost(
  ctx: MeshContext,
  tick: number,
  floorZ: number,
  source: ClipboardGhostTile[],
  baseX: number,
  baseY: number,
  baseZ: number,
  missing: Set<number>
): Float32Array | null {
  const { items, atlas } = ctx;
  const inst: number[] = [];

  for (const tile of source) {
    if (baseZ + tile.dz !== floorZ) continue;
    const tx = baseX + tile.dx;
    const ty = baseY + tile.dy;
    let elevation = 0;
    for (const it of tile.items) {
      const thing = items.get(it.clientId);
      if (!thing || thing.spriteIndex.length === 0) continue;
      emitThing(inst, thing, { x: tx, y: ty, atlas, tick, missing, count: it.count, elevation });
      elevation = stackElevation(elevation, thing);
    }
  }

  return inst.length > 0 ? new Float32Array(inst) : null;
}

export function buildSelectionGhost(
  ctx: MeshContext,
  tick: number,
  floorZ: number,
  selected: Iterable<{ x: number; y: number; z: number; all: boolean }>,
  shiftTilesX: number,
  shiftTilesY: number
): Float32Array | null {
  const { items, tiles, atlas } = ctx;
  const shiftX = shiftTilesX * TILE;
  const shiftY = shiftTilesY * TILE;
  const inst: number[] = [];

  for (const sel of selected) {
    if (sel.z !== floorZ) continue;
    const tx = sel.x;
    const ty = sel.y;
    const ct = tiles.get(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK), floorZ, tick);
    if (!ct) continue;
    const found = findTileIndex(ct, tx, ty);
    if (found < 0) continue;

    const start = ct.itemOffset[found];
    const end = ct.itemOffset[found + 1];
    const top = end - 1;
    let elevation = 0;
    for (let ii = start; ii < end; ii++) {
      const thing = items.get(ct.clientIds[ii]);
      if (!thing || thing.spriteIndex.length === 0) continue;
      if (sel.all || ii === top) {
        emitThing(inst, thing, { x: tx, y: ty, atlas, tick, count: ct.counts[ii], elevation, shiftX, shiftY });
      }
      elevation = stackElevation(elevation, thing);
    }
  }

  return inst.length > 0 ? new Float32Array(inst) : null;
}

export function buildPreviewGhost(
  ctx: MeshContext,
  tick: number,
  previewTiles: PreviewTile[],
  missing: Set<number>,
  seen: Set<number>
): { mesh: Float32Array; complete: boolean } {
  const { items, atlas } = ctx;
  const inst: number[] = [];
  let complete = true;

  for (const t of previewTiles) {
    let elevation = 0;
    for (let ii = 0; ii < t.clientIds.length; ii++) {
      const thing = items.get(t.clientIds[ii]);
      if (!thing || thing.spriteIndex.length === 0) continue;
      if (!emitThing(inst, thing, { x: t.x, y: t.y, atlas, tick, missing, seen, elevation })) complete = false;
      elevation = stackElevation(elevation, thing);
    }
  }

  return { mesh: new Float32Array(inst), complete };
}
