import { Thing } from '~/domain/thing';
import { ChunkTiles } from '~/domain/map';
import { Mask } from '~/lib/generator/hunt';
import { packChunkKey, fetchMapChunks } from '~/adapter/map';

const CHUNK = 32;

export interface HuntGrid {
  minX: number;
  minY: number;
  z: number;
  mask: Mask;
  stairs: Mask;
}

export function isWalkableTile(ct: ChunkTiles, i: number, items: Map<number, Thing>): boolean {
  let hasGround = false;
  for (let s = ct.itemOffset[i]; s < ct.itemOffset[i + 1]; s++) {
    const thing = items.get(ct.clientIds[s]);
    if (!thing) continue;
    if (thing.isUnpassable) return false;
    if (thing.isGround) hasGround = true;
  }
  return hasGround;
}

export async function readWalkableMask(
  mapId: number,
  z: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  items: Map<number, Thing>,
  floorChange?: Set<number>
): Promise<HuntGrid> {
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const mask: Mask = Array.from({ length: h }, () => new Array(w).fill(false));
  const stairs: Mask = Array.from({ length: h }, () => new Array(w).fill(false));

  const keys: number[] = [];
  const minCx = Math.floor(minX / CHUNK);
  const maxCx = Math.floor(maxX / CHUNK);
  const minCy = Math.floor(minY / CHUNK);
  const maxCy = Math.floor(maxY / CHUNK);
  for (let cy = minCy; cy <= maxCy; cy++) for (let cx = minCx; cx <= maxCx; cx++) keys.push(packChunkKey(cx, cy));

  const chunks = await fetchMapChunks(mapId, z, keys);
  for (const ct of chunks.values()) {
    if (!ct) continue;
    for (let i = 0; i < ct.tileX.length; i++) {
      const x = ct.tileX[i];
      const y = ct.tileY[i];
      if (x < minX || x > maxX || y < minY || y > maxY) continue;
      if (isWalkableTile(ct, i, items)) mask[y - minY][x - minX] = true;
      if (!floorChange?.size) continue;
      for (let s = ct.itemOffset[i]; s < ct.itemOffset[i + 1]; s++) {
        if (floorChange.has(ct.serverIds[s])) {
          stairs[y - minY][x - minX] = true;
          break;
        }
      }
    }
  }
  return { minX, minY, z, mask, stairs };
}
