import React from 'react';

import { OTB_VERSIONS } from '~/domain/tibia';
import { Input } from '~/components/commons/ui/input';
import { Button } from '~/components/commons/ui/button';
import { MapProperties as MapProps } from '~/domain/map';
import { getMapProperties, setMapProperties } from '~/adapter/map';
import { Select, SelectItem, SelectValue, SelectContent, SelectTrigger } from '~/components/commons/ui/select';
import { Dialog, DialogTitle, DialogHeader, DialogFooter, DialogContent } from '~/components/commons/ui/dialog';

interface MapPropertiesDialogProps {
  open: boolean;
  mapId: number | null;
  onSaved?: () => void;
  onOpenChange: (open: boolean) => void;
}

const MIN_MAP_SIZE = 64;
const MAX_MAP_SIZE = 65000;

const OTBM_VERSIONS: { value: number; label: string }[] = [
  { value: 1, label: 'OTServ 0.5.0' },
  { value: 2, label: 'OTServ 0.6.0' },
  { value: 3, label: 'OTServ 0.6.1' },
  { value: 4, label: 'OTServ 0.7.0 (revscriptsys)' }
];

const clientLabel = (id: number) => {
  const known = OTB_VERSIONS.find((v) => v.id === id);
  if (!known) return `Unknown (${id})`;
  return known.legacy ? `${known.label} (legacy)` : known.label;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const sectionClass = 'text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';
const fieldClass = 'flex flex-col gap-1 text-xs font-medium text-foreground';

const MapPropertiesDialog = ({ open, mapId, onSaved, onOpenChange }: MapPropertiesDialogProps) => {
  const [props, setProps] = React.useState<MapProps | null>(null);

  React.useEffect(() => {
    if (!open || mapId === null) return;
    void getMapProperties(mapId).then(setProps);
  }, [open, mapId]);

  const patch = (next: Partial<MapProps>) => setProps((p) => (p ? { ...p, ...next } : p));

  const versions = React.useMemo(() => {
    const current = props?.itemsMinor;
    const list = OTB_VERSIONS.filter((v) => !v.legacy || v.id === current);
    if (current !== undefined && !list.some((v) => v.id === current)) {
      return [...list, { id: current, label: clientLabel(current) }];
    }
    return list;
  }, [props?.itemsMinor]);

  const save = () => {
    if (mapId === null || !props) return;
    void setMapProperties(mapId, {
      description: props.description,
      spawnFile: props.spawnFile,
      houseFile: props.houseFile,
      otbmVersion: props.otbmVersion,
      itemsMinor: props.itemsMinor,
      width: clamp(props.width, MIN_MAP_SIZE, MAX_MAP_SIZE),
      height: clamp(props.height, MIN_MAP_SIZE, MAX_MAP_SIZE)
    }).then(() => {
      onSaved?.();
      onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Map Properties</DialogTitle>
        </DialogHeader>
        {props && (
          <div className="flex flex-col gap-4 p-4">
            <label className={fieldClass}>
              Description
              <textarea
                rows={2}
                value={props.description}
                placeholder="Describe this map"
                onChange={(e) => patch({ description: e.target.value })}
                className="w-full resize-none rounded-md border border-border bg-input px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </label>

            <div className="flex flex-col gap-2">
              <span className={sectionClass}>Format</span>
              <div className="grid grid-cols-2 gap-3">
                <label className={fieldClass}>
                  OTBM format
                  <Select value={String(props.otbmVersion)} onValueChange={(v) => patch({ otbmVersion: Number(v) })}>
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OTBM_VERSIONS.map((v) => (
                        <SelectItem key={v.value} value={String(v.value)}>
                          {v.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className={fieldClass}>
                  Client version
                  <Select value={String(props.itemsMinor)} onValueChange={(v) => patch({ itemsMinor: Number(v) })}>
                    <SelectTrigger className="h-8">
                      <SelectValue>{clientLabel(props.itemsMinor)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {versions.map((v) => (
                        <SelectItem key={v.id} textValue={v.label} value={String(v.id)}>
                          {clientLabel(v.id)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className={sectionClass}>Dimensions</span>
              <div className="grid grid-cols-2 gap-3">
                <label className={fieldClass}>
                  Width
                  <Input
                    type="number"
                    min={MIN_MAP_SIZE}
                    max={MAX_MAP_SIZE}
                    value={props.width}
                    onChange={(e) => patch({ width: Number(e.target.value) || 0 })}
                  />
                </label>
                <label className={fieldClass}>
                  Height
                  <Input
                    type="number"
                    min={MIN_MAP_SIZE}
                    max={MAX_MAP_SIZE}
                    value={props.height}
                    onChange={(e) => patch({ height: Number(e.target.value) || 0 })}
                  />
                </label>
              </div>
              <span className="text-[10px] text-muted-foreground">
                Between {MIN_MAP_SIZE} and {MAX_MAP_SIZE} tiles. Shrinking discards tiles outside the new bounds.
              </span>
            </div>

            <div className="flex flex-col gap-2">
              <span className={sectionClass}>External files</span>
              <div className="grid grid-cols-2 gap-3">
                <label className={fieldClass}>
                  Houses
                  <Input value={props.houseFile} onChange={(e) => patch({ houseFile: e.target.value })} />
                </label>
                <label className={fieldClass}>
                  Spawns
                  <Input value={props.spawnFile} onChange={(e) => patch({ spawnFile: e.target.value })} />
                </label>
              </div>
              <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                Waypoints
                <Input disabled value={props.waypointFile} />
              </label>
            </div>

            <div className="flex items-center gap-3 border-t border-border pt-3 text-[11px] text-muted-foreground">
              <span>{props.townCount} towns</span>
              <span className="text-border">|</span>
              <span>{props.waypointCount} waypoints</span>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={!props}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MapPropertiesDialog;
