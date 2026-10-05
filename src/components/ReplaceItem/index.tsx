import React from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Plus, Trash2, ArrowLeftRight } from 'lucide-react';

import { loadAllServerIds } from '~/adapter/materials';
import { Button } from '~/components/commons/ui/button';
import { useSetting } from '~/usecase/hooks/useSetting';
import { canQueue, readyPairs } from '~/usecase/replaceQueue';
import WindowTitleBar from '~/components/commons/WindowTitleBar';
import { countItems, replaceItems, ReplaceScope } from '~/adapter/map';
import { replaceKey, QueuedReplace, EnqueueRequest, ReplaceScopeId, REPLACE_ITEM_EVENTS } from '~/domain/replaceItem';

import QueueList from './QueueList';
import ItemPicker, { PickerItem } from './ItemPicker';
import { useReplaceContext } from './useReplaceContext';

const MAX_RESULTS = 200;
const COUNT_DEBOUNCE = 200;

const SCOPES: Array<{ id: ReplaceScopeId; label: string }> = [
  { id: 'map', label: 'Whole map' },
  { id: 'floor', label: 'Current floor' },
  { id: 'selection', label: 'Selection' }
];

const searchItems = (ids: number[], itemNames: Map<number, string> | null, query: string): PickerItem[] => {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const numeric = /^\d+$/.test(q);
  const out: PickerItem[] = [];
  for (const id of ids) {
    const name = itemNames?.get(id) ?? '';
    if (numeric ? String(id).includes(q) : name.toLowerCase().includes(q)) {
      out.push({ id, name });
      if (out.length >= MAX_RESULTS) break;
    }
  }
  return out;
};

const ReplaceItem = () => {
  const { mapId, title, floorZ, itemNames, requestSelection } = useReplaceContext();

  const [fromQuery, setFromQuery] = React.useState('');
  const [toQuery, setToQuery] = React.useState('');
  const [fromId, setFromId] = React.useState<number | null>(null);
  const [toId, setToId] = React.useState<number | null>(null);
  const [ids, setIds] = React.useState<number[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [feedback, setFeedback] = React.useState<string | null>(null);
  const [counts, setCounts] = React.useState<Map<number, number>>(new Map());
  const [queue, setQueue] = useSetting<QueuedReplace[]>('replaceItem.queue', []);
  const [scope, setScope] = useSetting<ReplaceScopeId>('replaceItem.scope', 'map');

  React.useEffect(() => {
    void loadAllServerIds().then(setIds);
  }, []);

  const deferredFrom = React.useDeferredValue(fromQuery);
  const deferredTo = React.useDeferredValue(toQuery);
  const fromResults = React.useMemo(() => searchItems(ids, itemNames, deferredFrom), [ids, itemNames, deferredFrom]);
  const toResults = React.useMemo(() => searchItems(ids, itemNames, deferredTo), [ids, itemNames, deferredTo]);

  const nameOf = React.useCallback((id: number) => itemNames?.get(id) ?? '', [itemNames]);

  const buildScope = React.useCallback(async (): Promise<ReplaceScope> => {
    if (scope === 'floor') return { floors: [floorZ] };
    if (scope === 'selection') return requestSelection();
    return {};
  }, [scope, floorZ, requestSelection]);

  const countedIds = React.useMemo(() => {
    const set = new Set(queue.map((p) => p.from));
    if (fromId !== null) set.add(fromId);
    return [...set];
  }, [queue, fromId]);

  React.useEffect(() => {
    if (mapId === null || countedIds.length === 0) {
      setCounts(new Map());
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void buildScope()
        .then((s) => countItems(mapId, countedIds, s))
        .then((result) => {
          if (cancelled) return;
          setCounts(new Map(countedIds.map((id, i) => [id, result[i] ?? 0])));
        })
        .catch((err) => console.error('Count failed', err));
    }, COUNT_DEBOUNCE);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mapId, countedIds, buildScope]);

  const addToQueue = () => {
    if (!canQueue(queue, fromId, toId) || fromId === null || toId === null) return;
    setQueue((prev) => [...prev, { from: fromId, to: toId, fromName: nameOf(fromId), toName: nameOf(toId) }]);
    setFeedback(null);
  };

  const assignTarget = (key: string) => {
    if (toId === null) return;
    setQueue((prev) => prev.map((p) => (replaceKey(p) === key ? { ...p, to: toId, toName: nameOf(toId) } : p)));
  };

  React.useEffect(() => {
    const pending = listen<EnqueueRequest>(REPLACE_ITEM_EVENTS.enqueue, (e) => {
      const incoming = e.payload.items;
      setQueue((prev) => {
        const known = new Set(prev.map((p) => p.from));
        const added = incoming
          .filter((item) => !known.has(item.from))
          .map((item) => ({ from: item.from, to: null, fromName: item.fromName, toName: '' }));
        return added.length === 0 ? prev : [...prev, ...added];
      });
      setFeedback(`Queued ${incoming.length} item${incoming.length === 1 ? '' : 's'} from the map`);
    });
    return () => {
      void pending.then((fn) => fn());
    };
  }, [setQueue]);

  const swap = () => {
    setFromId(toId);
    setToId(fromId);
    setFromQuery(toQuery);
    setToQuery(fromQuery);
  };

  const applyQueue = async () => {
    const pairs = readyPairs(queue);
    if (mapId === null || pairs.length === 0 || busy) return;
    setBusy(true);
    try {
      const result = await replaceItems(mapId, pairs, await buildScope());
      await emit(REPLACE_ITEM_EVENTS.replaced, result);
      setFeedback(
        result.total > 0 ? `Replaced ${result.total.toLocaleString()} item${result.total === 1 ? '' : 's'}` : 'No items replaced'
      );
      if (result.total > 0) setQueue((prev) => prev.filter((p) => p.to === null));
    } catch (e) {
      setFeedback(`Replace failed: ${e}`);
    } finally {
      setBusy(false);
    }
  };

  const applyRef = React.useRef(applyQueue);
  applyRef.current = applyQueue;

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void getCurrentWindow().destroy();
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void applyRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const previewCount = fromId === null ? null : (counts.get(fromId) ?? null);
  const ready = readyPairs(queue);
  const pendingTargets = queue.length - ready.length;
  const queuedTotal = ready.reduce((sum, p) => sum + (counts.get(p.from) ?? 0), 0);
  const summary =
    queue.length === 0
      ? ''
      : `${queuedTotal.toLocaleString()} replacements pending` +
        (pendingTargets > 0 ? ` - ${pendingTargets} without target` : '');

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <WindowTitleBar title="Replace Item" />
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {mapId === null ? 'No map open in the editor.' : `Map: ${title ?? mapId}`}
          </span>
          {SCOPES.map((s) => (
            <button
              key={s.id}
              onClick={() => setScope(s.id)}
              className={
                s.id === scope
                  ? 'rounded bg-accent px-2 py-1 text-xs text-accent-foreground'
                  : 'rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              }
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="flex min-h-0 flex-[3] gap-3">
          <ItemPicker
            query={fromQuery}
            selected={fromId}
            onSelect={setFromId}
            results={fromResults}
            onSubmit={addToQueue}
            onQuery={setFromQuery}
            label="Replace this item:"
          />
          <div className="flex flex-col justify-center">
            <Button size="icon" onClick={swap} variant="ghost" aria-label="Swap items">
              <ArrowLeftRight className="h-4 w-4" />
            </Button>
          </div>
          <ItemPicker
            query={toQuery}
            selected={toId}
            onSelect={setToId}
            results={toResults}
            onQuery={setToQuery}
            onSubmit={addToQueue}
            label="With this item:"
          />
        </div>

        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {previewCount === null ? '' : `${previewCount.toLocaleString()} in scope`}
          </span>
          <Button size="sm" onClick={addToQueue} disabled={!canQueue(queue, fromId, toId)}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add
          </Button>
        </div>

        <div className="flex min-h-0 flex-[2] flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-foreground">Queue ({queue.length})</span>
            <button
              onClick={() => setQueue([])}
              disabled={queue.length === 0}
              className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear
            </button>
          </div>
          <QueueList
            queue={queue}
            counts={counts}
            targetId={toId}
            onAssign={assignTarget}
            onRemove={(key) => setQueue((prev) => prev.filter((p) => replaceKey(p) !== key))}
          />
        </div>

        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{feedback ?? summary}</span>
          <Button variant="ghost" onClick={() => void getCurrentWindow().destroy()}>
            Close
          </Button>
          <Button onClick={applyQueue} disabled={busy || mapId === null || ready.length === 0}>
            Apply all
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ReplaceItem;
