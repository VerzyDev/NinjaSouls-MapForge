import { SPRITE_SIZE } from '~/domain/tibia';
import { LoadedSprite } from '~/domain/sprite';
import { colorizeOutfit } from '~/domain/outfit';
import { BrushSpriteLayout } from '~/usecase/brushSprite';

export function rasterizeLayout(
  layout: BrushSpriteLayout | null,
  cache: Map<number, LoadedSprite>,
  tileSize = SPRITE_SIZE
): HTMLCanvasElement | null {
  if (!layout || layout.cells.length === 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width = layout.cols * tileSize;
  canvas.height = layout.rows * tileSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const scratch = document.createElement('canvas');
  scratch.width = tileSize;
  scratch.height = tileSize;
  const sctx = scratch.getContext('2d');
  if (!sctx) return null;

  let drew = false;
  for (const cell of layout.cells) {
    const sprite = cache.get(cell.spriteId);
    if (!sprite || sprite.empty) continue;
    let rgba = sprite.rgba;
    if (cell.maskSpriteId != null && layout.colors) {
      const mask = cache.get(cell.maskSpriteId);
      if (mask && !mask.empty) rgba = colorizeOutfit(sprite.rgba, mask.rgba, layout.colors);
    }
    sctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), tileSize, tileSize), 0, 0);
    ctx.drawImage(scratch, cell.dx, cell.dy);
    drew = true;
  }

  return drew ? canvas : null;
}
