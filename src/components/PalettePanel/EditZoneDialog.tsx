import React from 'react';

import { Input } from '~/components/commons/ui/input';
import { Button } from '~/components/commons/ui/button';
import {
  CustomZone,
  customZoneColor,
  MAX_CUSTOM_ZONE_ID,
  CUSTOM_ZONE_FLOORS,
  isValidCustomZoneRange
} from '~/domain/customZone';
import { Dialog, DialogTitle, DialogHeader, DialogFooter, DialogContent } from '~/components/commons/ui/dialog';

interface EditZoneDialogProps {
  open: boolean;
  zone: CustomZone | null;
  takenIds: number[];
  onOpenChange: (open: boolean) => void;
  onSave: (previousId: number, next: CustomZone) => void;
}

const EditZoneDialog = ({ open, zone, takenIds, onOpenChange, onSave }: EditZoneDialogProps) => {
  const [idText, setIdText] = React.useState('');
  const [minZText, setMinZText] = React.useState('');
  const [maxZText, setMaxZText] = React.useState('');
  const [color, setColor] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    if (!open) return;
    setIdText(zone ? String(zone.id) : '');
    setMinZText(zone ? String(zone.minZ) : '');
    setMaxZText(zone ? String(zone.maxZ) : '');
    setColor(zone?.color);
  }, [open, zone]);

  if (!zone) return null;

  const id = Number(idText);
  const idError =
    !Number.isInteger(id) || id < 1 || id > MAX_CUSTOM_ZONE_ID
      ? `ID must be between 1 and ${MAX_CUSTOM_ZONE_ID}`
      : id !== zone.id && takenIds.includes(id)
        ? `Zone ${id} already exists`
        : '';

  const minZ = Number(minZText);
  const maxZ = Number(maxZText);
  const rangeError = isValidCustomZoneRange(minZ, maxZ)
    ? ''
    : `Floors must be between 0 and ${CUSTOM_ZONE_FLOORS - 1}, from the lower number to the higher`;

  const save = () => {
    if (idError || rangeError) return;
    onSave(zone.id, color ? { id, color, minZ, maxZ } : { id, minZ, maxZ });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit Zone</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 p-4">
          <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
            Zone ID
            <Input type="number" value={idText} onChange={(e) => setIdText(e.target.value)} />
            {idError && <span className="text-[10px] font-normal text-destructive">{idError}</span>}
          </label>
          <div className="flex flex-col gap-1 text-xs font-medium text-foreground">
            Floors
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={CUSTOM_ZONE_FLOORS - 1}
                value={minZText}
                onChange={(e) => setMinZText(e.target.value)}
              />
              <span className="text-muted-foreground">to</span>
              <Input
                type="number"
                min={0}
                max={CUSTOM_ZONE_FLOORS - 1}
                value={maxZText}
                onChange={(e) => setMaxZText(e.target.value)}
              />
            </div>
            {rangeError ? (
              <span className="text-[10px] font-normal text-destructive">{rangeError}</span>
            ) : (
              <span className="text-[10px] font-normal text-muted-foreground">
                The zone only exists on these floors. 7 is the ground floor, lower numbers go up and higher numbers go
                underground.
              </span>
            )}
          </div>
          <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
            Color
            <div className="flex items-center gap-2">
              <input
                type="color"
                onChange={(e) => setColor(e.target.value)}
                value={customZoneColor({ color }, Number.isInteger(id) ? id : zone.id)}
                className="h-7 w-10 cursor-pointer rounded border border-border bg-transparent p-0.5"
              />
              {color && (
                <Button size="sm" variant="ghost" onClick={() => setColor(undefined)}>
                  Reset
                </Button>
              )}
              {!color && <span className="text-[10px] font-normal text-muted-foreground">Automatic from the ID</span>}
            </div>
          </label>
          <span className="text-[10px] text-muted-foreground">
            The color is only used in Map Forge. Name and music are set per ID in the client (game_zones/zonelist.lua).
          </span>
        </div>
        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={!!idError || !!rangeError}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EditZoneDialog;
