import { Thing } from '~/domain/thing';
import { Mask } from '~/lib/generator/hunt';
import { packChunkKey, fetchMapChunks } from '~/adapter/map';

const CHUNK = 32;

export interface HuntGrid {
  minX: number;
  minY: number;
  z: number;
  mask: Mask;
}

export async function readWalkableMask(
  mapId: number,
  z: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  items: Map<number, Thing>
): Promise<HuntGrid> {
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const mask: Mask = Array.from({ length: h }, () => new Array(w).fill(false));

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
      const start = ct.itemOffset[i];
      const end = ct.itemOffset[i + 1];
      let hasGround = false;
      let blocked = false;
      for (let s = start; s < end; s++) {
        const thing = items.get(ct.clientIds[s]);
        if (!thing) continue;
        if (thing.isGround) hasGround = true;
        if (thing.isUnpassable) blocked = true;
      }
      if (hasGround && !blocked) mask[y - minY][x - minX] = true;
    }
  }
  return { minX, minY, z, mask };
}
