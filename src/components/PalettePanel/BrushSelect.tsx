import React from 'react';

import { BrushKind } from '~/domain/palette';
import { BrushOption } from '~/adapter/biomes';
import { LoadedSprite } from '~/domain/sprite';
import { loadSprites } from '~/adapter/sprites';
import { mapClientIds } from '~/adapter/assets';
import ZoneGlyph from '~/components/commons/ZoneGlyph';
import { useAssetsBundle } from '~/usecase/context/AssetsContext';
import VirtualSelect, { VirtualSelectRow } from '~/components/commons/ui/VirtualSelect';
import { resolveBrushThing, brushSpriteLayout, BrushSpriteLayout } from '~/usecase/brushSprite';

import BrushThumbnail from './BrushThumbnail';

const SPRITE_CACHE = new Map<number, LoadedSprite>();
const SERVER_TO_CLIENT = new Map<number, number>();
const CELL = 28;

interface BrushSelectProps {
  value: string;
  onChange: (name: string) => void;
  options: BrushOption[];
  placeholder?: string;
  allowNone?: boolean;
}

const BrushSelect = ({ value, onChange, options, placeholder, allowNone }: BrushSelectProps) => {
  const { assets } = useAssetsBundle();
  const items = assets!.items;
  const outfits = assets!.outfits;
  const sprPath = assets!.sprPath;
  const transparency = assets!.transparency;

  const [version, setVersion] = React.useState(0);
  const [visibleKeys, setVisibleKeys] = React.useState<string[]>([]);
  const [layouts, setLayouts] = React.useState<Map<string, BrushSpriteLayout | null>>(new Map());

  const byName = React.useMemo(() => new Map(options.map((o) => [o.name, o])), [options]);
  const rows = React.useMemo<VirtualSelectRow[]>(
    () => options.map((o) => ({ key: o.name, label: o.name, sublabel: o.kind })),
    [options]
  );

  const toResolve = React.useMemo(() => {
    const map = new Map<string, BrushOption>();
    const selected = byName.get(value);
    if (selected) map.set(selected.name, selected);
    for (const k of visibleKeys) {
      const o = byName.get(k);
      if (o) map.set(o.name, o);
    }
    return [...map.values()];
  }, [byName, value, visibleKeys]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const need = [...new Set(toResolve.filter((o) => o.lookType == null && !o.zoneTool).map((o) => o.serverId))].filter(
        (id) => {
          const c = SERVER_TO_CLIENT.get(id);
          return c === undefined || c === 0;
        }
      );
      if (need.length) {
        const cids = await mapClientIds(need);
        need.forEach((sid, i) => {
          const c = cids[i] ?? 0;
          if (c) SERVER_TO_CLIENT.set(sid, c);
        });
      }
      if (cancelled) return;
      const map = new Map<string, BrushSpriteLayout | null>();
      const spriteIds: number[] = [];
      for (const o of toResolve) {
        if (o.zoneTool) continue;
        const creature = o.lookType != null;
        const brush = { key: o.name, name: o.name, kind: o.kind as BrushKind, lookServerId: o.serverId, lookType: o.lookType };
        const thing = resolveBrushThing(brush, items, outfits, SERVER_TO_CLIENT);
        const colors = creature ? { head: o.head ?? 0, body: o.body ?? 0, legs: o.legs ?? 0, feet: o.feet ?? 0 } : undefined;
        const layout = thing ? brushSpriteLayout(thing, creature, colors) : null;
        map.set(o.name, layout);
        if (layout) for (const cell of layout.cells) spriteIds.push(cell.spriteId);
      }
      setLayouts((prev) => new Map([...prev, ...map]));
      await loadSprites(sprPath, spriteIds, transparency, SPRITE_CACHE);
      if (!cancelled) setVersion((v) => v + 1);
    })().catch((err) => console.error('Failed to resolve brush sprites', err));
    return () => {
      cancelled = true;
    };
  }, [toResolve, items, outfits, sprPath, transparency]);

  const renderThumb = (key: string) => {
    const zone = byName.get(key)?.zoneTool;
    if (zone) return <ZoneGlyph size={CELL} tool={zone} />;
    return <BrushThumbnail size={CELL} version={version} cache={SPRITE_CACHE} layout={layouts.get(key) ?? null} />;
  };

  return (
    <VirtualSelect
      rows={rows}
      value={value}
      onChange={onChange}
      allowNone={allowNone}
      renderThumb={renderThumb}
      placeholder={placeholder}
      onVisibleKeys={setVisibleKeys}
    />
  );
};

export default BrushSelect;
