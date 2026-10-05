import React from 'react';

import { Input } from '~/components/commons/ui/input';
import { useTool } from '~/usecase/context/ToolContext';
import { Slider } from '~/components/commons/ui/slider';
import { Button } from '~/components/commons/ui/button';
import { Checkbox } from '~/components/commons/ui/checkbox';
import { Dialog, DialogTitle, DialogHeader, DialogFooter, DialogContent } from '~/components/commons/ui/dialog';

interface ReferenceImageDialogProps {
  open: boolean;
  center: { x: number; y: number } | null;
  onOpenChange: (open: boolean) => void;
}

const fieldClass = 'flex flex-col gap-1 text-xs font-medium text-foreground';

const DEFAULT_TILES_WIDE = 64;

const DEFAULT_TOLERANCE = 12;

const ReferenceImageDialog = ({ open, center, onOpenChange }: ReferenceImageDialogProps) => {
  const { referenceImage, setReferenceImage, patchReferenceImage } = useTool();
  const fileRef = React.useRef<HTMLInputElement>(null);

  const pick = (file: File | undefined) => {
    if (!file) return;
    setReferenceImage({
      name: file.name,
      src: URL.createObjectURL(file),
      x: referenceImage?.x ?? Math.max(0, Math.round((center?.x ?? 0) - DEFAULT_TILES_WIDE / 2)),
      y: referenceImage?.y ?? Math.max(0, Math.round((center?.y ?? 0) - DEFAULT_TILES_WIDE / 2)),
      tilesWide: referenceImage?.tilesWide ?? DEFAULT_TILES_WIDE,
      opacity: referenceImage?.opacity ?? 0.6,
      tolerance: referenceImage?.tolerance ?? DEFAULT_TOLERANCE,
      visible: true,
      unlocked: false,
      front: referenceImage?.front ?? false
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reference Image</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 p-4">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
              Choose image...
            </Button>
            <span className="truncate text-xs text-muted-foreground">{referenceImage?.name ?? 'No image loaded'}</span>
            <input
              hidden
              type="file"
              ref={fileRef}
              accept="image/*"
              onChange={(e) => {
                pick(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>

          {referenceImage && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <label className={fieldClass}>
                  X
                  <Input
                    type="number"
                    value={referenceImage.x}
                    onChange={(e) => patchReferenceImage({ x: Number(e.target.value) || 0 })}
                  />
                </label>
                <label className={fieldClass}>
                  Y
                  <Input
                    type="number"
                    value={referenceImage.y}
                    onChange={(e) => patchReferenceImage({ y: Number(e.target.value) || 0 })}
                  />
                </label>
                <label className={fieldClass}>
                  Width (tiles)
                  <Input
                    min={1}
                    type="number"
                    value={referenceImage.tilesWide}
                    onChange={(e) => patchReferenceImage({ tilesWide: Math.max(1, Number(e.target.value) || 1) })}
                  />
                </label>
              </div>

              <label className={fieldClass}>
                Opacity {Math.round(referenceImage.opacity * 100)}%
                <Slider
                  max={1}
                  min={0.05}
                  step={0.05}
                  value={[referenceImage.opacity]}
                  onValueChange={([v]) => patchReferenceImage({ opacity: v })}
                />
              </label>

              <label className={fieldClass}>
                Color tolerance {referenceImage.tolerance}%
                <Slider
                  min={0}
                  max={60}
                  step={1}
                  value={[referenceImage.tolerance]}
                  onValueChange={([v]) => patchReferenceImage({ tolerance: v })}
                />
              </label>

              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-xs text-foreground">
                  <Checkbox
                    checked={referenceImage.visible}
                    onCheckedChange={(v) => patchReferenceImage({ visible: v === true })}
                  />
                  Show on map
                </label>
                <label className="flex items-center gap-2 text-xs text-foreground">
                  <Checkbox checked={referenceImage.front} onCheckedChange={(v) => patchReferenceImage({ front: v === true })} />
                  Draw above the map
                </label>
                <label className="flex items-center gap-2 text-xs text-foreground">
                  <Checkbox
                    checked={referenceImage.unlocked}
                    onCheckedChange={(v) => patchReferenceImage({ unlocked: v === true })}
                  />
                  Unlock (drag and resize on map)
                </label>
              </div>
              <span className="text-[10px] text-muted-foreground">
                R cycles behind the map, above the map and hidden. While the image is shown, the fill (G) and magic wand (W) tools
                follow its colors instead of the ground - hold Alt to work on the map ground again.
              </span>
            </>
          )}
        </div>
        <DialogFooter>
          <Button size="sm" variant="ghost" disabled={!referenceImage} onClick={() => setReferenceImage(null)}>
            Remove
          </Button>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ReferenceImageDialog;
