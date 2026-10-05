import React from 'react';

import { Thing } from '~/domain/thing';
import { LoadedSprite } from '~/domain/sprite';
import { TILE } from '~/components/MapCanvas/constants';
import { rasterizeLayout } from '~/usecase/spriteRaster';
import { brushSpriteLayout, fluidSpriteLayout } from '~/usecase/brushSprite';

const THUMB = 32;

interface ItemSpriteProps {
  version: number;
  clientId: number;
  subtype?: number;
  items: Map<number, Thing>;
  cache: Map<number, LoadedSprite>;
}

const ItemSprite = ({ cache, items, version, clientId, subtype }: ItemSpriteProps) => {
  const ref = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, THUMB, THUMB);
    const thing = items.get(clientId);
    if (!thing) return;
    const layout = subtype != null ? fluidSpriteLayout(thing, subtype) : brushSpriteLayout(thing, false);
    const off = rasterizeLayout(layout, cache, TILE);
    if (!off) return;
    const offW = off.width;
    const offH = off.height;
    const scale = Math.min(THUMB / offW, THUMB / offH);
    const dw = offW * scale;
    const dh = offH * scale;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, (THUMB - dw) / 2, (THUMB - dh) / 2, dw, dh);
  }, [clientId, items, cache, version, subtype]);

  return (
    <canvas ref={ref} width={THUMB} height={THUMB} className="h-8 w-8 flex-shrink-0" style={{ imageRendering: 'pixelated' }} />
  );
};

export default ItemSprite;
