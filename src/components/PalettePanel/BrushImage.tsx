import React from 'react';

import { BrushKind } from '~/domain/palette';
import { BrushOption } from '~/adapter/biomes';
import { LoadedSprite } from '~/domain/sprite';
import { loadSprites } from '~/adapter/sprites';
import { mapClientIds } from '~/adapter/assets';
import ZoneGlyph from '~/components/commons/ZoneGlyph';
import { useAssetsBundle } from '~/usecase/context/AssetsContext';
import { resolveBrushThing, brushSpriteLayout, BrushSpriteLayout } from '~/usecase/brushSprite';

import BrushThumbnail from './BrushThumbnail';

const SPRITE_CACHE = new Map<number, LoadedSprite>();
const SERVER_TO_CLIENT = new Map<number, number>();
const CELL = 28;

const BrushImage = ({ option, size = 24 }: { option: BrushOption | null; size?: number }) => {
  const { assets } = useAssetsBundle();

  const [layout, setLayout] = React.useState<BrushSpriteLayout | null>(null);
  const [version, setVersion] = React.useState(0);

  const optionRef = React.useRef(option);
  optionRef.current = option;
  const optionKey = option
    ? [
        option.serverId,
        option.kind,
        option.name,
        option.lookType,
        option.head,
        option.body,
        option.legs,
        option.feet,
        option.zoneTool
      ].join(':')
    : '';

  React.useEffect(() => {
    const option = optionRef.current;
    if (!option || option.zoneTool || !assets) {
      setLayout(null);
      return;
    }
    const { items, outfits, sprPath, transparency } = assets;
    let cancelled = false;
    (async () => {
      const creature = option.lookType != null;
      const sid = option.serverId;
      if (!creature) {
        let client = SERVER_TO_CLIENT.get(sid);
        if (!client) {
          const [cid] = await mapClientIds([sid]);
          client = cid ?? 0;
          if (client) SERVER_TO_CLIENT.set(sid, client);
        }
      }
      if (cancelled) return;
      const brush = {
        key: option.name,
        name: option.name,
        kind: option.kind as BrushKind,
        lookServerId: sid,
        lookType: option.lookType
      };
      const thing = resolveBrushThing(brush, items, outfits, SERVER_TO_CLIENT);
      const colors = creature
        ? { head: option.head ?? 0, body: option.body ?? 0, legs: option.legs ?? 0, feet: option.feet ?? 0 }
        : undefined;
      const lay = thing ? brushSpriteLayout(thing, creature, colors) : null;
      setLayout(lay);
      if (lay)
        await loadSprites(
          sprPath,
          lay.cells.map((c) => c.spriteId),
          transparency,
          SPRITE_CACHE
        );
      if (!cancelled) setVersion((v) => v + 1);
    })().catch((err) => console.error('Failed to resolve brush sprite', err));
    return () => {
      cancelled = true;
    };
  }, [optionKey, assets]);

  if (option?.zoneTool) return <ZoneGlyph size={size} tool={option.zoneTool} />;

  return (
    <span
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center overflow-hidden rounded bg-muted/40"
    >
      <BrushThumbnail size={CELL} layout={layout} version={version} cache={SPRITE_CACHE} />
    </span>
  );
};

export default BrushImage;
