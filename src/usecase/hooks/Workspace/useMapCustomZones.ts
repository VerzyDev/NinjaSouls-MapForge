import React from 'react';

import { hasSidecars } from '~/lib/map/sidecars';
import { MapCustomZones } from '~/domain/customZone';
import { loadServerZones } from '~/adapter/customZones';

interface CustomZoneSource {
  id: string;
  path?: string;
}

export interface MapCustomZonesApi {
  customZones: MapCustomZones | null;
  setCustomZones: React.Dispatch<React.SetStateAction<MapCustomZones | null>>;
}

export const useMapCustomZones = (
  active: CustomZoneSource | null,
  load: (mapPath: string) => Promise<MapCustomZones> = loadServerZones
): MapCustomZonesApi => {
  const [customZones, setCustomZones] = React.useState<MapCustomZones | null>(null);

  React.useEffect(() => {
    if (!active?.path || !hasSidecars(active.path)) {
      setCustomZones(null);
      return;
    }
    let cancelled = false;
    void load(active.path).then((zones) => {
      if (!cancelled) setCustomZones(zones);
    });
    return () => {
      cancelled = true;
    };
  }, [active?.id, active?.path, load]);

  return { customZones, setCustomZones };
};
