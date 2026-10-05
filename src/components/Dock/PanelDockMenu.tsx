import React from 'react';
import { Check, MoreVertical } from 'lucide-react';

import { cn } from '~/usecase/classNames';
import { MapCorner, MAP_CORNERS } from '~/domain/dock';
import { Hint } from '~/components/commons/ui/tooltip';

interface PanelDockMenuProps {
  corner: MapCorner | null;
  onFloat: () => void;
  onPick: (corner: MapCorner) => void;
}

const CORNER_LABEL: Record<MapCorner, string> = {
  'top-left': 'Top left',
  'top-right': 'Top right',
  'bottom-left': 'Bottom left',
  'bottom-right': 'Bottom right'
};

const PanelDockMenu = ({ corner, onFloat, onPick }: PanelDockMenuProps) => {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const choose = (fn: () => void) => {
    fn();
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <Hint side="bottom" label="Dock options">
        <button
          onClick={() => setOpen((v) => !v)}
          onPointerDown={(e) => e.stopPropagation()}
          className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-item-hover hover:text-foreground"
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </button>
      </Hint>
      {open && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute right-0 top-6 z-50 min-w-[150px] overflow-hidden rounded-md border border-border bg-popover py-1 text-xs text-popover-foreground shadow-island-lg"
        >
          <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">Dock to corner</div>
          {MAP_CORNERS.map((c) => (
            <button
              key={c}
              onClick={() => choose(() => onPick(c))}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-accent"
            >
              <Check className={cn('h-3 w-3 flex-shrink-0', corner === c ? 'opacity-100' : 'opacity-0')} />
              {CORNER_LABEL[c]}
            </button>
          ))}
          <div className="my-1 h-px bg-border" />
          <button
            onClick={() => choose(onFloat)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-accent"
          >
            <Check className={cn('h-3 w-3 flex-shrink-0', corner === null ? 'opacity-100' : 'opacity-0')} />
            Floating
          </button>
        </div>
      )}
    </div>
  );
};

export default PanelDockMenu;
