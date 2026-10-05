import React from 'react';

import { cn } from '~/usecase/classNames';
import BrushImage from '~/components/PalettePanel/BrushImage';

interface ItemTileProps {
  index: number;
  height: number;
  name: string;
  serverId: number;
  selected: boolean;
  onSelect: (index: number) => void;
  onPick: (index: number) => void;
}

const ItemTile = ({ index, height, name, serverId, selected, onSelect, onPick }: ItemTileProps) => {
  const option = React.useMemo(() => ({ name, kind: 'raw', serverId, paintId: serverId }), [name, serverId]);

  return (
    <button
      type="button"
      style={{ height }}
      onClick={() => onSelect(index)}
      onDoubleClick={() => onPick(index)}
      title={name ? `${serverId} - ${name}` : String(serverId)}
      className={cn(
        'group flex flex-col items-center justify-center gap-1.5 rounded-md p-2 transition-colors',
        selected ? 'bg-primary/10' : 'hover:bg-item-hover'
      )}
    >
      <span
        className={cn(
          'flex shrink-0 items-center justify-center rounded ring-1 ring-inset transition-colors',
          selected ? 'ring-primary' : 'ring-border/60 group-hover:ring-border'
        )}
      >
        <BrushImage size={48} option={option} />
      </span>
      <span
        className={cn(
          'w-full shrink-0 truncate font-mono text-[11px] leading-4 tabular-nums',
          selected ? 'text-foreground' : 'text-muted-foreground'
        )}
      >
        {serverId}
      </span>
      <span className="w-full shrink-0 truncate text-[10px] leading-4 text-muted-foreground/70">{name || ' '}</span>
    </button>
  );
};

export default React.memo(ItemTile);
