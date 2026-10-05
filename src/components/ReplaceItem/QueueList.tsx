import { X, ArrowRight, TriangleAlert } from 'lucide-react';

import { queueWarning } from '~/usecase/replaceQueue';
import BrushImage from '~/components/PalettePanel/BrushImage';
import { replaceKey, QueuedReplace } from '~/domain/replaceItem';

interface QueueListProps {
  queue: QueuedReplace[];
  counts: Map<number, number>;
  targetId: number | null;
  onRemove: (key: string) => void;
  onAssign: (key: string) => void;
}

const label = (id: number, name: string) => (name ? `${id} - ${name}` : String(id));

const QueueList = ({ queue, counts, targetId, onRemove, onAssign }: QueueListProps) => {
  if (queue.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center rounded border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
        Nothing queued. Pick two items and press Add, or right-click a selection on the map.
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto rounded border border-border bg-input/40">
      {queue.map((pair, index) => {
        const warning = queueWarning(queue, index);
        const hits = counts.get(pair.from);
        const key = replaceKey(pair);
        return (
          <div key={key} className="flex items-center gap-2 border-b border-border/40 px-2 py-1 last:border-b-0">
            <BrushImage size={32} option={{ name: pair.fromName, kind: 'raw', serverId: pair.from, paintId: pair.from }} />
            <span className="min-w-0 flex-1 truncate text-xs text-foreground">{label(pair.from, pair.fromName)}</span>
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            {pair.to === null ? (
              <button
                disabled={targetId === null}
                onClick={() => onAssign(key)}
                className="min-w-0 flex-1 truncate rounded border border-dashed border-border px-2 py-0.5 text-left text-xs text-muted-foreground hover:border-primary hover:text-foreground disabled:opacity-40"
              >
                {targetId === null ? 'no target' : 'Set target'}
              </button>
            ) : (
              <>
                <BrushImage size={32} option={{ name: pair.toName, kind: 'raw', serverId: pair.to, paintId: pair.to }} />
                <span className="min-w-0 flex-1 truncate text-xs text-foreground">{label(pair.to, pair.toName)}</span>
              </>
            )}
            {warning && <TriangleAlert aria-label={warning} className="h-3.5 w-3.5 shrink-0 text-amber-400" />}
            <span className="w-20 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
              {hits === undefined ? '-' : hits.toLocaleString()}
            </span>
            <button
              onClick={() => onRemove(key)}
              aria-label="Remove from queue"
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default QueueList;
