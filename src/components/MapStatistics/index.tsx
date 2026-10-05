import React from 'react';

import { MapStatistics } from '~/domain/map';
import { MapSpawns } from '~/domain/creature';
import { MapWaypoints } from '~/domain/waypoint';
import { getMapStatistics } from '~/adapter/map';
import { Button } from '~/components/commons/ui/button';
import { Dialog, DialogTitle, DialogHeader, DialogFooter, DialogContent } from '~/components/commons/ui/dialog';

interface MapStatisticsDialogProps {
  open: boolean;
  mapId: number | null;
  spawns: MapSpawns | null;
  waypoints: MapWaypoints | null;
  onOpenChange: (open: boolean) => void;
}

const Row = ({ label, value }: { label: string; value: string | number }) => (
  <div className="flex items-center justify-between gap-4 py-0.5">
    <span className="text-muted-foreground">{label}</span>
    <span className="font-mono text-foreground">{value}</span>
  </div>
);

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-0.5">
    <div className="mb-1 text-xs font-semibold text-foreground">{title}</div>
    <div className="flex flex-col pl-2 text-xs">{children}</div>
  </div>
);

const MapStatisticsDialog = ({ open, mapId, spawns, waypoints, onOpenChange }: MapStatisticsDialogProps) => {
  const [stats, setStats] = React.useState<MapStatistics | null>(null);
  const [loading, setLoading] = React.useState(false);

  const spawnCount = spawns?.areas.length ?? 0;
  const npcCount = spawns?.placements.filter((p) => p.isNpc).length ?? 0;
  const creatureCount = (spawns?.placements.length ?? 0) - npcCount;
  const waypointCount = waypoints?.list.length ?? 0;

  React.useEffect(() => {
    if (!open || mapId === null) {
      setStats(null);
      return;
    }
    setLoading(true);
    void getMapStatistics(mapId)
      .then(setStats)
      .finally(() => setLoading(false));
  }, [open, mapId]);

  const itemsPerTile = stats && stats.tileCount > 0 ? (stats.itemCount / stats.tileCount).toFixed(2) : '0';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Map Statistics</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading && <div className="py-8 text-center text-xs text-muted-foreground">Collecting data...</div>}
          {!loading && stats && (
            <div className="flex flex-col gap-4">
              <Section title="Dimensions">
                <Row label="Size" value={`${stats.width} x ${stats.height}`} />
                <Row label="Bounds X" value={`${stats.minX} .. ${stats.maxX}`} />
                <Row label="Bounds Y" value={`${stats.minY} .. ${stats.maxY}`} />
              </Section>

              <Section title="Tile data">
                <Row label="Total tiles" value={stats.tileCount} />
                <Row label="Total items" value={stats.itemCount} />
                <Row value={itemsPerTile} label="Mean items per tile" />
                <Row label="House tiles" value={stats.houseTileCount} />
                <Row label="Teleports" value={stats.teleportCount} />
              </Section>

              <Section title="Floors">
                {stats.floors.map((f) => (
                  <Row key={f.z} label={`Floor ${f.z}`} value={`${f.tileCount} tiles`} />
                ))}
              </Section>

              <Section title="Markers">
                <Row label="Spawns" value={spawnCount} />
                <Row label="Creatures" value={creatureCount} />
                <Row label="NPCs" value={npcCount} />
                <Row label="Waypoints" value={waypointCount} />
              </Section>

              <Section title="Town data">
                <Row label="Total towns" value={stats.townCount} />
              </Section>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MapStatisticsDialog;
