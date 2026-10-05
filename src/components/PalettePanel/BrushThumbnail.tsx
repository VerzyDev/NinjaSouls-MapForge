import React from 'react';

import { LoadedSprite } from '~/domain/sprite';
import { TILE } from '~/components/MapCanvas/constants';
import { rasterizeLayout } from '~/usecase/spriteRaster';
import { BrushSpriteLayout } from '~/usecase/brushSprite';
import { useEditorSettings } from '~/usecase/context/EditorSettingsContext';

interface BrushThumbnailProps {
  size: number;
  version: number;
  layout: BrushSpriteLayout | null;
  cache: Map<number, LoadedSprite>;
}

const BrushThumbnail = ({ layout, cache, version, size }: BrushThumbnailProps) => {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const { fullSpriteThumbnails } = useEditorSettings();

  React.useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || size;
    const cssH = canvas.clientHeight || size;
    const backingW = Math.max(1, Math.round(cssW * dpr));
    const backingH = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== backingW) canvas.width = backingW;
    if (canvas.height !== backingH) canvas.height = backingH;

    ctx.clearRect(0, 0, backingW, backingH);
    if (!layout) return;

    const off = rasterizeLayout(layout, cache, TILE);
    if (!off) return;
    const offW = off.width;
    const offH = off.height;

    let sx = 0;
    let sy = 0;
    let sw = offW;
    let sh = offH;
    if (!fullSpriteThumbnails && layout.exactSize > 0 && layout.exactSize < Math.max(offW, offH)) {
      sw = Math.min(layout.exactSize, offW);
      sh = Math.min(layout.exactSize, offH);
      sx = offW - sw;
      sy = offH - sh;
    }

    const k = Math.max(4, Math.ceil(backingW / sw));
    const pre = document.createElement('canvas');
    pre.width = sw * k;
    pre.height = sh * k;
    const pctx = pre.getContext('2d');
    if (!pctx) return;
    pctx.imageSmoothingEnabled = false;
    pctx.drawImage(off, sx, sy, sw, sh, 0, 0, pre.width, pre.height);

    const fit = Math.min(backingW / pre.width, backingH / pre.height);
    const dw = pre.width * fit;
    const dh = pre.height * fit;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(pre, (backingW - dw) / 2, (backingH - dh) / 2, dw, dh);
  }, [layout, cache, version, size, fullSpriteThumbnails]);

  return <canvas ref={ref} className="h-full w-full" />;
};

export default BrushThumbnail;
