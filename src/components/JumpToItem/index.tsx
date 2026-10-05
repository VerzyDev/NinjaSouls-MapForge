import React from 'react';

import { loadAllServerIds } from '~/adapter/materials';
import { useTool } from '~/usecase/context/ToolContext';
import { Button } from '~/components/commons/ui/button';
import BrushImage from '~/components/PalettePanel/BrushImage';
import { useAssetsBundle } from '~/usecase/context/AssetsContext';
import PaletteSearch from '~/components/PalettePanel/PaletteSearch';
import { mapClientIds, loadItemCaps, loadItemTypes } from '~/adapter/assets';
import { FinderRow, FINDER_GROUPS, buildFinderRows, filterFinderRows, availableFilters } from '~/lib/itemFinder';
import {
  Dialog,
  DialogTitle,
  DialogHeader,
  DialogFooter,
  DialogContent,
  DialogDescription
} from '~/components/commons/ui/dialog';

import FilterSidebar from './FilterSidebar';
import ResultGrid, { GRID_COLUMNS } from './ResultGrid';

interface JumpToItemProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MAX_RESULTS = 600;

const JumpToItem = ({ open, onOpenChange }: JumpToItemProps) => {
  const { assets, dataDir } = useAssetsBundle();
  const { selectBrush, revealInPalette } = useTool();

  const [rows, setRows] = React.useState<FinderRow[]>([]);
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState<Set<string>>(new Set());
  const [cursor, setCursor] = React.useState(0);
  const searchRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open || !assets || rows.length > 0) return;
    let cancelled = false;
    (async () => {
      const serverIds = await loadAllServerIds();
      const [clientIds, caps, types] = await Promise.all([
        mapClientIds(serverIds),
        loadItemCaps(serverIds).catch(() => []),
        loadItemTypes(dataDir)
      ]);
      if (cancelled) return;
      setRows(buildFinderRows(serverIds, { clientIds, caps, types, things: assets.items, names: assets.itemNames }));
    })().catch((e) => console.error('item finder catalog failed', e));
    return () => {
      cancelled = true;
    };
  }, [open, assets, dataDir, rows.length]);

  const groups = React.useMemo(
    () => FINDER_GROUPS.map((group) => ({ group, filters: availableFilters(rows, group) })).filter((g) => g.filters.length > 0),
    [rows]
  );

  const deferredQuery = React.useDeferredValue(query);
  const results = React.useMemo(() => filterFinderRows(rows, deferredQuery, active, MAX_RESULTS), [rows, deferredQuery, active]);

  React.useEffect(() => setCursor(0), [deferredQuery, active]);

  const selected = results[cursor] ?? null;

  const jump = (row: FinderRow | null) => {
    if (!row) return;
    selectBrush({
      key: `raw-${row.serverId}`,
      name: row.name || `Item ${row.serverId}`,
      kind: 'rawItem',
      serverId: row.serverId,
      isGround: row.thing?.isGround ?? false,
      cols: row.thing?.width ?? 1,
      rows: row.thing?.height ?? 1
    });
    revealInPalette('raw', row.serverId);
    onOpenChange(false);
  };

  const jumpRef = React.useRef(jump);
  jumpRef.current = jump;
  const resultsRef = React.useRef(results);
  resultsRef.current = results;
  const pick = React.useCallback((index: number) => jumpRef.current(resultsRef.current[index] ?? null), []);

  const toggle = (id: string) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const onKeyDown = (e: React.KeyboardEvent) => {
    const inSearch = (e.target as HTMLElement).tagName === 'INPUT';
    if (inSearch && query.length > 0 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;
    const step =
      e.key === 'ArrowRight'
        ? 1
        : e.key === 'ArrowLeft'
          ? -1
          : e.key === 'ArrowDown'
            ? GRID_COLUMNS
            : e.key === 'ArrowUp'
              ? -GRID_COLUMNS
              : 0;
    if (step !== 0) {
      e.preventDefault();
      setCursor((c) => Math.max(0, Math.min(results.length - 1, c + step)));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      jump(selected);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onKeyDown={onKeyDown}
        className="h-[80vh] max-w-4xl"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          searchRef.current?.querySelector('input')?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Jump to Item</DialogTitle>
          <DialogDescription>Search by id or name, narrow it down with filters, then jump to the RAW brush.</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1">
          <FilterSidebar groups={groups} active={active} onToggle={toggle} onClear={() => setActive(new Set())} />
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-[52px] items-center gap-3 border-b border-border px-3">
              <div ref={searchRef} className="flex-1">
                <PaletteSearch value={query} onChange={setQuery} placeholder="Search by id or name..." />
              </div>
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {results.length}
                {results.length === MAX_RESULTS ? '+' : ''} {results.length === 1 ? 'item' : 'items'}
              </span>
            </div>
            <ResultGrid
              onPick={pick}
              rows={results}
              cursor={cursor}
              onSelect={setCursor}
              empty={
                rows.length === 0 ? 'Loading item catalog' : query || active.size > 0 ? 'No items match' : 'Nothing to show yet'
              }
              hint={
                rows.length === 0
                  ? 'Reading the item database.'
                  : query || active.size > 0
                    ? 'Try a shorter name, a partial id, or drop a filter.'
                    : 'Search by id or name, or pick a filter on the left.'
              }
            />
          </div>
        </div>
        <DialogFooter className="justify-between">
          <div className="flex min-w-0 items-center gap-2.5">
            {selected ? (
              <>
                <span className="flex items-center justify-center rounded ring-1 ring-inset ring-border/60">
                  <BrushImage
                    size={32}
                    option={{ name: selected.name, kind: 'raw', serverId: selected.serverId, paintId: selected.serverId }}
                  />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="font-mono text-xs tabular-nums text-foreground">{selected.serverId}</span>
                  <span className="truncate text-[11px] text-muted-foreground">{selected.name || 'unnamed item'}</span>
                </span>
              </>
            ) : (
              <span className="text-[11px] text-muted-foreground">Arrow keys move, Enter jumps</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={!selected} onClick={() => jump(selected)}>
              Jump to item
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default JumpToItem;
