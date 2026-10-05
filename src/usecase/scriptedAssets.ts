import { Thing } from '~/domain/thing';
import { ThingCategory } from '~/domain/tibia';
import { LoadedAssets } from '~/adapter/assets';
import { containerIds, scriptedThings, itemNames as fetchItemNames } from '~/adapter/scripts';

export async function buildScriptedAssets(sprPath: string): Promise<LoadedAssets> {
  const things = await scriptedThings();
  const itemNames = await fetchItemNames();
  const containers = new Set(await containerIds());

  const items = new Map<number, Thing>();
  for (const t of things) {
    items.set(t.id, {
      id: t.id,
      width: t.width || 1,
      height: t.height || 1,
      layers: t.layers || 1,
      frames: t.frames || 1,
      patternX: t.patternX || 1,
      patternY: t.patternY || 1,
      patternZ: t.patternZ || 1,
      offsetX: t.offsetX,
      offsetY: t.offsetY,
      elevation: t.elevation,
      groundSpeed: t.groundSpeed,
      exactSize: t.exactSize || 32,
      spriteIndex: t.spriteIndex,
      isContainer: containers.has(t.id),
      isGround: t.isGround,
      isGroundBorder: t.isGroundBorder,
      isOnBottom: t.isOnBottom,
      isOnTop: t.isOnTop,
      hasOffset: t.hasOffset,
      hasElevation: t.hasElevation,
      stackable: false,
      hangable: false,
      isUnpassable: false,
      miniMap: false,
      miniMapColor: 0,
      category: ThingCategory.ITEM,
      attrs: t.attrs
    });
  }

  return {
    items,
    outfits: new Map(),
    itemNames,
    creatures: new Map(),
    spawnMarkerClientId: 0,
    waypointMarkerClientId: 0,
    sprPath,
    transparency: true,
    spritesCount: items.size,
    otbItemCount: items.size,
    spriteSize: 32
  };
}
