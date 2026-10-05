import React from 'react';
import { FolderOpen } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { revealItemInDir } from '@tauri-apps/plugin-opener';

import { exportMinimap } from '~/adapter/minimap';
import { ExportedMinimapFloor } from '~/domain/map';
import { Input } from '~/components/commons/ui/input';
import { useSetting } from '~/usecase/hooks/useSetting';
import { Button } from '~/components/commons/ui/button';
import { Dialog, DialogTitle, DialogHeader, DialogFooter, DialogContent } from '~/components/commons/ui/dialog';

type Scope = 'current' | 'all' | 'range';

interface MinimapExportProps {
  open: boolean;
  mapId: number | null;
  floors: number[];
  currentFloor: number;
  defaultName: string;
  onOpenChange: (open: boolean) => void;
}

const selectClass =
  'flex h-8 w-full rounded-md border border-border bg-input px-2.5 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

const MinimapExport = ({ open: isOpen, mapId, floors, currentFloor, defaultName, onOpenChange }: MinimapExportProps) => {
  const [dir, setDir] = useSetting('minimapExportDir', '');
  const [name, setName] = React.useState(defaultName);
  const [scope, setScope] = React.useState<Scope>('current');
  const [from, setFrom] = React.useState(0);
  const [to, setTo] = React.useState(15);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<ExportedMinimapFloor[] | null>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    setName(defaultName);
    setScope('current');
    setError(null);
    setResult(null);
  }, [isOpen, defaultName]);

  const selected = React.useMemo(() => {
    if (scope === 'current') return floors.includes(currentFloor) ? [currentFloor] : [];
    if (scope === 'all') return floors;
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    return floors.filter((z) => z >= lo && z <= hi);
  }, [scope, floors, currentFloor, from, to]);

  const pickFolder = async () => {
    const picked = await open({ multiple: false, directory: true, title: 'Select output folder' });
    if (typeof picked === 'string') setDir(picked);
  };

  const run = async () => {
    if (mapId === null || !dir || selected.length === 0) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await exportMinimap(mapId, selected, dir, name));
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Export Minimap</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 p-4">
          <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
            Output folder
            <div className="flex gap-2">
              <Input value={dir} placeholder="Choose a folder..." onChange={(e) => setDir(e.target.value)} />
              <Button size="sm" variant="secondary" onClick={() => void pickFolder()}>
                <FolderOpen className="h-3.5 w-3.5" />
              </Button>
            </div>
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
            File name
            <Input value={name} onChange={(e) => setName(e.target.value)} />
            <span className="text-[10px] font-normal text-muted-foreground">One PNG per floor, named {name || 'map'}_z.png</span>
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
            Floors
            <select value={scope} className={selectClass} onChange={(e) => setScope(e.target.value as Scope)}>
              <option value="current">Current floor ({currentFloor})</option>
              <option value="all">All floors</option>
              <option value="range">Floor range</option>
            </select>
          </label>

          {scope === 'range' && (
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
                From
                <Input min={0} max={15} value={from} type="number" onChange={(e) => setFrom(Number(e.target.value))} />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
                To
                <Input min={0} max={15} value={to} type="number" onChange={(e) => setTo(Number(e.target.value))} />
              </label>
            </div>
          )}

          {error && <div className="text-xs text-destructive">{error}</div>}

          {result && (
            <div className="flex flex-col gap-1 rounded-md border border-border/60 bg-secondary/40 p-2 text-xs">
              {result.length === 0 ? (
                <span className="text-muted-foreground">Nothing to export - selected floors are empty.</span>
              ) : (
                <>
                  <span className="text-foreground">Exported {result.length} image(s)</span>
                  {result.map((f) => (
                    <div
                      key={f.z}
                      className="flex items-center justify-between gap-3 font-mono text-[10px] text-muted-foreground"
                    >
                      <span>floor {f.z}</span>
                      <span>
                        {f.width} x {f.height} at {f.minX},{f.minY}
                      </span>
                    </div>
                  ))}
                  <Button size="sm" variant="ghost" className="self-start" onClick={() => void revealItemInDir(result[0].path)}>
                    Show in folder
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button size="sm" onClick={() => void run()} disabled={busy || !dir || mapId === null || selected.length === 0}>
            {busy ? 'Exporting...' : `Export ${selected.length} floor(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MinimapExport;
