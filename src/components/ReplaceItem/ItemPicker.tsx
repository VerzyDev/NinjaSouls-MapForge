import React from 'react';

import { cn } from '~/usecase/classNames';
import BrushImage from '~/components/PalettePanel/BrushImage';
import PaletteSearch from '~/components/PalettePanel/PaletteSearch';

export interface PickerItem {
  id: number;
  name: string;
}

interface ItemPickerProps {
  label: string;
  query: string;
  results: PickerItem[];
  selected: number | null;
  onQuery: (value: string) => void;
  onSelect: (id: number) => void;
  onSubmit: () => void;
}

const ItemPicker = ({ label, query, results, selected, onQuery, onSelect, onSubmit }: ItemPickerProps) => {
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (results[0]) onSelect(results[0].id);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <span className="text-xs font-semibold text-foreground">{label}</span>
      <div onKeyDown={onKeyDown}>
        <PaletteSearch value={query} onChange={onQuery} placeholder="Search by id or name..." />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded border border-border bg-input/40">
        {results.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">
            {query.trim() ? 'No items found.' : 'Type an id or a name to search.'}
          </div>
        ) : (
          results.map(({ id, name }) => (
            <button
              key={id}
              onDoubleClick={onSubmit}
              onClick={() => onSelect(id)}
              className={cn(
                'flex w-full items-center gap-2 px-2 py-1 text-left text-xs text-foreground hover:bg-accent hover:text-accent-foreground',
                selected === id && 'bg-accent text-accent-foreground'
              )}
            >
              <BrushImage size={32} option={{ name, kind: 'raw', serverId: id, paintId: id }} />
              <span className="min-w-0 flex-1 truncate">{name ? `${id} - ${name}` : id}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
};

export default ItemPicker;
