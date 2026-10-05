import * as lz4 from 'lz4js';
import { invoke } from '@tauri-apps/api/core';

import { SPRITE_SIZE } from '~/domain/tibia';
import { LoadedSprite } from '~/domain/sprite';

function spriteDataSize(spriteSize: number): number {
  return spriteSize * spriteSize * 4;
}

function parseRgbaSprites(buffer: Uint8Array, spriteSize = SPRITE_SIZE): LoadedSprite[] {
  const SPRITE_DATA_SIZE = spriteDataSize(spriteSize);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const sprites: LoadedSprite[] = [];
  let offset = 0;
  if (view.byteLength < 4) return sprites;

  const count = view.getUint32(offset, true);
  offset += 4;

  for (let i = 0; i < count; i++) {
    if (offset + 9 > view.byteLength) break;
    const id = view.getUint32(offset, true);
    offset += 4;
    const empty = view.getUint8(offset) === 1;
    offset += 1;
    const compressedLen = view.getUint32(offset, true);
    offset += 4;
    offset += compressedLen;
    if (offset + SPRITE_DATA_SIZE > view.byteLength) break;
    const rgba = buffer.slice(offset, offset + SPRITE_DATA_SIZE);
    offset += SPRITE_DATA_SIZE;
    sprites.push({ id, empty, rgba });
  }
  return sprites;
}

let generation = 0;
const stamps = new WeakMap<Map<number, LoadedSprite>, number>();

export function invalidateSpriteCaches(): void {
  generation++;
}

export async function loadSprites(
  sprPath: string,
  ids: number[],
  transparent: boolean,
  cache: Map<number, LoadedSprite>,
  spriteSize = SPRITE_SIZE
): Promise<void> {
  const stale = stamps.get(cache) !== generation;
  stamps.set(cache, generation);
  const wanted = [...new Set(ids.filter((id) => id > 0))];
  const missing = stale ? wanted : wanted.filter((id) => !cache.has(id));
  if (missing.length === 0) return;

  const compressed = await invoke<Uint8Array | ArrayBuffer>('read_sprites_rgba_lz4', {
    path: sprPath,
    ids: missing,
    transparent
  });
  const compressedBuf = compressed instanceof Uint8Array ? compressed : new Uint8Array(compressed);
  const decompressed = lz4.decompress(compressedBuf);
  for (const sprite of parseRgbaSprites(decompressed, spriteSize)) {
    cache.set(sprite.id, sprite);
  }
}
