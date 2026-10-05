import React from 'react';

import { cn } from '~/usecase/classNames';
import { loadAllServerIds } from '~/adapter/materials';
import { Button } from '~/components/commons/ui/button';
import { replaceItems, ReplaceResult } from '~/adapter/map';
import BrushImage from '~/components/PalettePanel/BrushImage';
import PaletteSearch from '~/components/PalettePanel/PaletteSearch';
import { Dialog, DialogTitle, DialogHeader, DialogFooter, DialogContent } from '~/components/commons/ui/dialog';

interface ReplaceItemDialogProps {
  open: boolean;
  mapId: number | null;
  itemNames: Map<number, string> | null;
  onOpenChange: (open: boolean) => void;
  onReplaced: (result: ReplaceResult) => void;
}

const MAX_RESULTS = 200;

const searchItems = (ids: number[], itemNames: Map<number, string> | null, query: string) => {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const numeric = /^\d+$/.test(q);
  const out: Array<[number, string]> = [];
  for (const id of ids) {
    const name = itemNames?.get(id) ?? '';
    if (numeric ? String(id).includes(q) : name.toLowerCase().includes(q)) {
      out.push([id, name]);
      if (out.length >= MAX_RESULTS) break;
    }
  }
  return out;
};

interface ItemPickerProps {
  label: string;
  selected: number | null;
  results: Array<[number, string]>;
  query: string;
  onQuery: (value: string) => void;
  onSelect: (id: number) => void;
}

const ItemPicker = ({ label, query, results, selected, onQuery, onSelect }: ItemPickerProps) => (
  <div className="flex min-h-0 flex-1 flex-col gap-1.5">
    <span className="text-xs font-semibold text-foreground">{label}</span>
    <PaletteSearch value={query} onChange={onQuery} placeholder="Search by id or name..." />
    <div className="min-h-0 flex-1 overflow-y-auto rounded border border-border bg-input/40">
      {results.length === 0 ? (
        <div className="p-4 text-center text-xs text-muted-foreground">
          {query.trim() ? 'No items found.' : 'Please enter your search string.'}
        </div>
      ) : (
        results.map(([id, name]) => (
          <button
            key={id}
            onClick={() => onSelect(id)}
            className={cn(
              'flex w-full items-center gap-2 px-2 py-1 text-left text-xs text-foreground hover:bg-accent hover:text-accent-foreground',
              selected === id && 'bg-accent text-accent-foreground'
            )}
          >
            <BrushImage option={{ name, kind: 'raw', serverId: id, paintId: id }} />
            <span className="min-w-0 flex-1 truncate">{name ? `${id} - ${name}` : id}</span>
          </button>
        ))
      )}
    </div>
  </div>
);

const ReplaceItemDialog = ({ open, mapId, itemNames, onOpenChange, onReplaced }: ReplaceItemDialogProps) => {
  const [fromQuery, setFromQuery] = React.useState('');
  const [toQuery, setToQuery] = React.useState('');
  const [fromId, setFromId] = React.useState<number | null>(null);
  const [toId, setToId] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [ids, setIds] = React.useState<number[]>([]);

  React.useEffect(() => {
    if (open) return;
    setFromQuery('');
    setToQuery('');
    setFromId(null);
    setToId(null);
  }, [open]);

  React.useEffect(() => {
    if (!open || ids.length > 0) return;
    void loadAllServerIds().then(setIds);
  }, [open, ids.length]);

  const fromResults = React.useMemo(() => searchItems(ids, itemNames, fromQuery), [ids, itemNames, fromQuery]);
  const toResults = React.useMemo(() => searchItems(ids, itemNames, toQuery), [ids, itemNames, toQuery]);

  const submit = async () => {
    if (mapId === null || fromId === null || toId === null || fromId === toId) return;
    setBusy(true);
    try {
      onReplaced(await replaceItems(mapId, fromId, toId));
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[70vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>Replace Item</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 gap-4 p-4">
          <ItemPicker
            query={fromQuery}
            selected={fromId}
            onSelect={setFromId}
            results={fromResults}
            onQuery={setFromQuery}
            label="Replace this item:"
          />
          <ItemPicker
            query={toQuery}
            selected={toId}
            onSelect={setToId}
            results={toResults}
            onQuery={setToQuery}
            label="With this item:"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || mapId === null || fromId === null || toId === null || fromId === toId}>
            Replace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ReplaceItemDialog;
