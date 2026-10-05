import { Thing } from '~/domain/thing';
import { SPRITE_SIZE } from '~/domain/tibia';
import { LoadedSprite } from '~/domain/sprite';
import { rasterizeLayout } from '~/usecase/spriteRaster';
import { brushSpriteLayout } from '~/usecase/brushSprite';

export function buildItemPreview(
  thing: Thing | undefined,
  spriteData: Map<number, LoadedSprite>,
  tileSize = SPRITE_SIZE
): string | undefined {
  if (!thing || thing.spriteIndex.length === 0) return undefined;
  const layout = brushSpriteLayout(thing, false, undefined, tileSize);
  return rasterizeLayout(layout, spriteData, tileSize)?.toDataURL();
}
