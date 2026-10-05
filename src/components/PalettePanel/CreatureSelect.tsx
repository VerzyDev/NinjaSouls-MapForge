import React from 'react';

import { LoadedSprite } from '~/domain/sprite';
import { loadSprites } from '~/adapter/sprites';
import { useAssetsBundle } from '~/usecase/context/AssetsContext';
import { HuntMonster } from '~/usecase/context/ToolContext/types';
import { brushSpriteLayout, BrushSpriteLayout } from '~/usecase/brushSprite';
import VirtualSelect, { VirtualSelectRow } from '~/components/commons/ui/VirtualSelect';

import BrushThumbnail from './BrushThumbnail';

const SPRITE_CACHE = new Map<number, LoadedSprite>();
const CELL = 28;

function useCreatureLayout(monster: HuntMonster | null): { layout: BrushSpriteLayout | null; version: number } {
  const { assets } = useAssetsBundle();
  const [layout, setLayout] = React.useState<BrushSpriteLayout | null>(null);
  const [version, setVersion] = React.useState(0);

  React.useEffect(() => {
    if (!monster || !assets) {
      setLayout(null);
      return;
    }
    const thing = assets.outfits.get(monster.lookType);
    if (!thing) {
      setLayout(null);
      return;
    }
    const colors = { head: monster.head, body: monster.body, legs: monster.legs, feet: monster.feet };
    const lay = brushSpriteLayout(thing, true, colors);
    setLayout(lay);
    let cancelled = false;
    const spriteIds = lay.cells.flatMap((c) => (c.maskSpriteId != null ? [c.spriteId, c.maskSpriteId] : [c.spriteId]));
    loadSprites(assets.sprPath, spriteIds, assets.transparency, SPRITE_CACHE)
      .then(() => {
        if (!cancelled) setVersion((v) => v + 1);
      })
      .catch((err) => console.error('Failed to load creature sprites', err));
    return () => {
      cancelled = true;
    };
  }, [monster, assets]);

  return { layout, version };
}

export const CreatureImage = ({ monster, size = 32 }: { monster: HuntMonster; size?: number }) => {
  const { layout, version } = useCreatureLayout(monster);
  return (
    <span
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center overflow-hidden rounded bg-muted/40"
    >
      <BrushThumbnail size={CELL} layout={layout} version={version} cache={SPRITE_CACHE} />
    </span>
  );
};

const Thumb = ({ monster }: { monster: HuntMonster }) => {
  const { layout, version } = useCreatureLayout(monster);
  return <BrushThumbnail size={CELL} layout={layout} version={version} cache={SPRITE_CACHE} />;
};

interface CreatureSelectProps {
  options: HuntMonster[];
  onPick: (monster: HuntMonster) => void;
  placeholder?: string;
}

const CreatureSelect = ({ options, onPick, placeholder }: CreatureSelectProps) => {
  const byName = React.useMemo(() => new Map(options.map((m) => [m.name, m])), [options]);
  const rows = React.useMemo<VirtualSelectRow[]>(() => options.map((m) => ({ key: m.name, label: m.name })), [options]);

  const renderThumb = (key: string) => {
    const m = byName.get(key);
    return m ? <Thumb monster={m} /> : null;
  };

  return (
    <VirtualSelect
      value=""
      rows={rows}
      renderThumb={renderThumb}
      placeholder={placeholder}
      onChange={(name) => {
        const m = byName.get(name);
        if (m) onPick(m);
      }}
    />
  );
};

export default CreatureSelect;
