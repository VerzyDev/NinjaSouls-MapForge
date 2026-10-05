import React from 'react';
import { PackageSearch } from 'lucide-react';

import { FinderRow } from '~/lib/itemFinder';

import ItemTile from './ItemTile';

interface ResultGridProps {
  rows: FinderRow[];
  cursor: number;
  empty: string;
  hint: string;
  onSelect: (index: number) => void;
  onPick: (index: number) => void;
}

export const GRID_COLUMNS = 6;

const ROW_HEIGHT = 112;
const OVERSCAN = 2;

const ResultGrid = ({ rows, cursor, empty, hint, onSelect, onPick }: ResultGridProps) => {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [startRow, setStartRow] = React.useState(0);
  const [visibleRows, setVisibleRows] = React.useState(8);

  const recompute = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setStartRow(Math.max(0, Math.floor(el.scrollTop / ROW_HEIGHT) - OVERSCAN));
    setVisibleRows(Math.ceil(el.clientHeight / ROW_HEIGHT) + OVERSCAN * 2);
  }, []);

  React.useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    recompute();
    el.addEventListener('scroll', recompute, { passive: true });
    const observer = new ResizeObserver(recompute);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', recompute);
      observer.disconnect();
    };
  }, [recompute, rows.length === 0]);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el || cursor < 0) return;
    const row = Math.floor(cursor / GRID_COLUMNS);
    const top = row * ROW_HEIGHT;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_HEIGHT - el.clientHeight;
  }, [cursor]);

  if (rows.length === 0)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <PackageSearch className="h-7 w-7 text-muted-foreground/50" />
        <span className="text-xs font-medium text-foreground">{empty}</span>
        <span className="max-w-[280px] text-[11px] leading-relaxed text-muted-foreground">{hint}</span>
      </div>
    );

  const totalRows = Math.ceil(rows.length / GRID_COLUMNS);
  const start = startRow * GRID_COLUMNS;
  const end = Math.min(rows.length, (startRow + visibleRows) * GRID_COLUMNS);

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
      <div className="relative" style={{ height: totalRows * ROW_HEIGHT }}>
        <div style={{ top: startRow * ROW_HEIGHT }} className="absolute inset-x-0 grid grid-cols-6">
          {rows.slice(start, end).map((row, offset) => (
            <ItemTile
              name={row.name}
              onPick={onPick}
              key={row.serverId}
              onSelect={onSelect}
              height={ROW_HEIGHT}
              index={start + offset}
              serverId={row.serverId}
              selected={start + offset === cursor}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default ResultGrid;
