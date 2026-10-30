import React from 'react';
import { IconMapPin } from '@tabler/icons-react';
import { Plus, Trash2, Pencil, CircleSlash2 } from 'lucide-react';

import { cn } from '~/usecase/classNames';
import { Hint } from '~/components/commons/ui/tooltip';
import { useTool } from '~/usecase/context/ToolContext';
import { CustomZoneMode } from '~/usecase/context/ToolContext/types';
import {
  CustomZone,
  MapCustomZones,
  sortCustomZones,
  customZoneColor,
  nextCustomZoneId,
  removeCustomZone,
  updateCustomZone,
  emptyMapCustomZones,
  customZoneTileCounts,
  DEFAULT_CUSTOM_ZONE_RANGE
} from '~/domain/customZone';

import PaletteSearch from './PaletteSearch';
import EditZoneDialog from './EditZoneDialog';

interface ZonesListProps {
  zones: MapCustomZones | null;
  onEdit: (next: MapCustomZones) => void;
}

const CUSTOM_ZONE_MODES: { mode: CustomZoneMode; label: string; help: string }[] = [
  { mode: 'brush', label: 'Brush', help: 'Brush: paint tile by tile.' },
  {
    mode: 'fill',
    label: 'Fill',
    help: 'Fill: click a walkable tile to fill every walkable tile connected to it, plus the walls and trees inside. It stops at blocked tiles and at tiles already in this zone, so paint a line with the brush to close a gap. Ctrl-click erases the connected part of the zone.'
  },
  {
    mode: 'polygon',
    label: 'Polygon',
    help: 'Polygon: click the corners of the area, then click the first corner, double-click or press Enter to fill. Ctrl erases, Backspace undoes a corner, Esc cancels.'
  }
];

const ZonesList = ({ zones, onEdit }: ZonesListProps) => {
  const {
    activeTool,
    activeCustomZoneId,
    customZoneAllFloors,
    customZoneMode,
    setActiveTool,
    setActiveCustomZone,
    setCustomZoneAllFloors,
    setCustomZoneMode
  } = useTool();
  const [query, setQuery] = React.useState('');
  const [dialogZone, setDialogZone] = React.useState<CustomZone | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const counts = React.useMemo(() => (zones ? customZoneTileCounts(zones) : new Map<number, number>()), [zones]);

  const list = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return sortCustomZones(zones?.list ?? []).filter((z) => !q || String(z.id).includes(q));
  }, [zones, query]);

  const selectZone = (id: number) => {
    setActiveCustomZone(id);
    if (activeTool !== 'custom_zone') setActiveTool('custom_zone');
  };

  const addZone = () => {
    const base = zones ?? emptyMapCustomZones();
    const zone: CustomZone = { id: nextCustomZoneId(base), ...DEFAULT_CUSTOM_ZONE_RANGE };
    onEdit({ list: [...base.list, zone], tiles: base.tiles });
    selectZone(zone.id);
    setDialogZone(zone);
    setDialogOpen(true);
  };

  const removeZone = (id: number) => {
    if (!zones) return;
    onEdit(removeCustomZone(zones, id));
    if (activeCustomZoneId === id) setActiveCustomZone(null);
  };

  const saveZone = (previousId: number, next: CustomZone) => {
    if (!zones) return;
    onEdit(updateCustomZone(zones, previousId, next));
    if (activeCustomZoneId === previousId) setActiveCustomZone(next.id);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-shrink-0 flex-col gap-1.5 border-b border-border/50 p-2">
        <PaletteSearch value={query} onChange={setQuery} placeholder="Search zones...">
          {activeCustomZoneId != null && (
            <Hint label="Deselect zone">
              <button
                onClick={() => setActiveCustomZone(null)}
                className="rounded p-0.5 text-muted-foreground hover:bg-item-hover hover:text-foreground"
              >
                <CircleSlash2 className="h-3.5 w-3.5" />
              </button>
            </Hint>
          )}
          <Hint label="Add zone">
            <button onClick={addZone} className="rounded p-0.5 text-muted-foreground hover:bg-item-hover hover:text-foreground">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </Hint>
        </PaletteSearch>
        <div className="flex gap-1">
          {CUSTOM_ZONE_MODES.map((option) => (
            <button
              key={option.mode}
              onClick={() => setCustomZoneMode(option.mode)}
              className={cn(
                'flex-1 rounded px-1.5 py-0.5 text-[10px]',
                customZoneMode === option.mode
                  ? 'bg-primary/20 text-foreground'
                  : 'text-muted-foreground hover:bg-item-hover hover:text-foreground'
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {[
            { allFloors: true, label: 'All floors' },
            { allFloors: false, label: 'This floor' }
          ].map((option) => (
            <button
              key={option.label}
              onClick={() => setCustomZoneAllFloors(option.allFloors)}
              className={cn(
                'flex-1 rounded px-1.5 py-0.5 text-[10px]',
                customZoneAllFloors === option.allFloors
                  ? 'bg-primary/20 text-foreground'
                  : 'text-muted-foreground hover:bg-item-hover hover:text-foreground'
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className="px-0.5 text-[10px] text-muted-foreground">{CUSTOM_ZONE_MODES.find((o) => o.mode === customZoneMode)?.help}</span>
        <span className="px-0.5 text-[10px] text-muted-foreground">
          Ctrl removes, Shift-drag paints a box, Alt-click selects the zone of a tile. All floors applies to every floor of
          the zone&apos;s range; This floor only to the current one, for exceptions. A tile holds one zone per floor:
          painting another zone replaces it. Saved to the map&apos;s -zones folder.
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {list.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">No zones. Click + to add one.</div>
        ) : (
          list.map((z) => (
            <div
              key={z.id}
              onClick={() => selectZone(z.id)}
              className={cn(
                'group flex cursor-pointer items-center gap-1.5 px-2 py-1 text-xs',
                activeCustomZoneId === z.id ? 'bg-primary/20 text-foreground' : 'hover:bg-accent'
              )}
            >
              <IconMapPin className="h-3 w-3 flex-shrink-0" style={{ color: customZoneColor(z, z.id) }} />
              <span className="min-w-0 flex-1 truncate text-foreground">Zone {z.id}</span>
              <span className="flex-shrink-0 font-mono text-[9px] text-muted-foreground">
                z{z.minZ === z.maxZ ? z.minZ : `${z.minZ}-${z.maxZ}`}
              </span>
              <span className="flex-shrink-0 font-mono text-[9px] text-muted-foreground">{counts.get(z.id) ?? 0} tiles</span>
              <Hint label="Edit zone">
                <button
                  className="flex-shrink-0 rounded p-0.5 text-muted-foreground opacity-0 hover:bg-item-hover hover:text-foreground group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDialogZone(z);
                    setDialogOpen(true);
                  }}
                >
                  <Pencil className="h-3 w-3" />
                </button>
              </Hint>
              <Hint label="Remove zone">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeZone(z.id);
                  }}
                  className="flex-shrink-0 rounded p-0.5 text-muted-foreground opacity-0 hover:bg-item-hover hover:text-destructive group-hover:opacity-100"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </Hint>
            </div>
          ))
        )}
      </div>

      <EditZoneDialog
        open={dialogOpen}
        zone={dialogZone}
        onSave={saveZone}
        onOpenChange={setDialogOpen}
        takenIds={(zones?.list ?? []).map((z) => z.id)}
      />
    </div>
  );
};

export default ZonesList;
